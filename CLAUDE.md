# Capture Inbox (working name)

Screenshot-based capture inbox that resurfaces saved intent at the right moment. Users share any screenshot in 2 taps. The app extracts what it is and, more importantly, WHEN to bring it back: sale/deadline alerts for shopping, map pins for places. Push-first product, not a destination app.

## Core thesis (do not lose this)

- People screenshot "ambiguously important" info constantly. Saved items are almost never revisited (research: ~16% of saved bookmarks are ever retrieved).
- Saving itself is the psychological reward. Retrieval requires a trigger, and no trigger exists. Storage apps become graveyards.
- Therefore the product is NOT organization. It is resurfacing. Value = the app reaches out (push) at the moment of relevance. Benchmark: flight price alerts, Karrot keyword alerts, 폴센트-class price alert apps. Nobody opens those apps daily; everybody taps the push.
- Wedge: shopping intents with embedded triggers (deadlines, prices, sales) and places seen in Reels/Shorts (text can't be copied there). These are the only painkiller segments. Everything else is a generic fallback, not the pitch.
- DAU is explicitly NOT a goal. This app is healthy at 1-2 opens/week if notification CTR and action conversion are high.
- Open risk: the "~90% of screenshots are shopping with triggers" prior is n=1 (founder's album). Published data puts shopping at 1 of ~9 screenshot themes. The album autopsy decides this; do not build further on the prior until it is in.

## Architecture: universal inbox, vertical resolvers

Inbox accepts anything (share extension). A classifier routes each capture to a resolver pipeline.

### 0. Extraction (privacy mode)

- Default path: on-device Vision OCR in the share extension -> `ocr_text` uploaded with the image -> text-only LLM structuring. Screenshot pixels never reach an external AI API on this path; the server keeps the image only as a thumbnail.
- Image VLM extraction is opt-in (`ALLOW_IMAGE_EXTRACTION`, default off) for captures with no usable OCR text. Without it, such captures fail as `no_text` rather than guessing.
- Tiered resolver direction: the fast tier (OCR text -> structuring -> search -> fetch-and-verify) ships now; an agentic deep-search escalation for LOW-confidence captures comes later. Async by design: "share-and-forget time" is the processing budget, and the card is a living status (found / delisted / restocked / price moved), not just a link.

### 1. Shopping resolver

- Extract from OCR text: domain, product name, price, currency, deadline text ("7-day group buy", "sale ends", release dates).
- Identification confidence tiers:
  - HIGH: domain + product name visible (most commerce screenshots) -> direct site search.
  - MEDIUM: brand handle only (e.g. Instagram seller post).
  - LOW: image only -> visual search, present as "similar results", never as a definitive match.
- Link resolution rules (CRITICAL):
  - The LLM NEVER generates URLs. Extraction schemas contain no URL fields. LLM output is used only to build search queries. Candidate links come exclusively from search API results or deterministically constructed search-results URLs.
  - Search backbone (verified 2026-09): the Naver Shopping search API was permanently terminated 2026-07-31 with no replacement; do not plan on it. Candidates come from the 11st OpenAPI ProductSearch (the only fully open Korean commerce search API, returns price + detail URL) merged with Google Custom Search restricted to the trusted-domain allowlist.
  - Server-side verification loop before any link is shown: fetch the candidate page, confirm extracted product name/price actually appear on it. Match -> `verified` link. No match -> fall back to a search-results link (the visible retailer's own search page when known, else Naver integrated search). Never ship an unverified "confident" link.
  - Verification is attempted on the top 3 ranked candidates; a card carries at most 3 candidates. Link confidence is shown as one of three states (verified / similar results / search results), never as a percentage.
  - Safety: domain allowlist (Naver, Kakao, official store domains first), Google Safe Browsing check, link preview showing the domain before opening.
- Deadlines: `deadline_at` is set only from explicit dates in the deadline text ("9월 12일까지", "9/12 마감", "2026.09.12"); relative text ("7일간", "곧 마감", "D-3") never schedules an alert.
- Price tracking worker: for verified product URLs, poll periodically, parse price/stock, fire push on drop/sale/restock. Known hard parts: option-level prices (color/size), page structure changes, bot blocking. Coverage order: 11st (API) -> Naver SmartStore (page parsing) -> independent malls (custom scraping, later). Coupang: the Partners API is gated behind ~150,000 KRW cumulative attributed sales ("final approval") and rate-limited far below polling needs (unusable for price tracking); the site is bot-managed. Start generating attributed link sales early; no Coupang tracking plan until approval clears.
- Monetization path: affiliate commission on push -> purchase.

### 2. Place resolver

- Extract place name + area from Reels/Shorts/blog screenshots.
- Query Naver Local Search API -> coordinates, address, place info. Naver Local survives the 2026 API changes via the NAVER API HUB (new endpoints/auth); legacy keys keep working until 2027-06-30, migrate before then.
- Save as pin on in-app map (Naver or Kakao Maps SDK). Tap pin -> deep link to the place page in Naver Maps.
- Target experience: "saw a restaurant in a Reel, two taps, it's a pin on my map."

### 3. Generic fallback

- OCR everything, store as a searchable card. Weekly digest push only. Do not over-invest here; dateless "someday" intent is disposable by nature.

### Deferred verticals

- Travel (flights/hotels): deferred. Flight/hotel data is partner-gated (Amadeus self-service closed 2026-07, Skyscanner/Kiwi/Booking require partnerships) and 트리플 already ships fare alerts in Korea. Fails both the data-access and the differentiation test.

## Notification precision rule

Precision >> recall. Two or three wrong alerts and users disable notifications, which kills the product. When uncertain, send nothing or send a low-commitment digest item, never a confident wrong alert. Every card has a "not this" button; wrong-link rate is a first-class quality metric.

- Every push trigger is logged (`notification_log`, unique per card + kind) before delivery: the same trigger never fires twice.
- Schedule (KST): deadline alert once, D-1 in the 19:30-21:30 evening window; weekly digest Sunday evening only when the week saved something (never a hollow digest); price alert at most once per card and only for verified links with high confidence and a >= 10% drop; "찾았어요" push on resolve is a validation-cohort flag (`PUSH_ON_RESOLVED`).

## Tech stack (decided)

- iOS native: Swift + SwiftUI. Reasons: the hard 20% (share extension, PhotoKit, background tasks, push) is native regardless of framework; Flutter would add a plugin-glue layer without covering the hard parts. Validation cohort is iPhone-heavy (Korean 20s).
- Capture entries (verified on iOS 26):
  - Primary: share extension from the screenshot preview (2 taps). iOS 26 shows a full-screen preview by default and does not auto-save unless the user taps Save, so "scan the screenshots folder" flows miss captures anyway. Share extension memory cap (~120 MB): OCR on a downscaled image, hand off to App Group + background URLSession, notify by push when the card is ready.
  - Secondary: in-app PHPicker with the `.screenshots` filter (zero photo permission; multi-select seeds the backlog at onboarding).
  - Deferred: full-library auto-scan. There is NO screenshots-only permission on iOS; enumerating screenshots needs Full access (PHAsset mediaSubtype == .photoScreenshot filtering), which App Review 5.1.1(iii) discourages and iOS 17+ periodically nags users to downgrade. Using photo-library-derived data for affiliate monetization is a 5.1.2(vi) risk that needs legal review before this ships.
  - Share-extension friction doubles as a willingness-to-pay signal. Pipeline latency is realistically 5-15 s, so the async-by-push design is forced regardless.
- Backend: Python + FastAPI. Workers for price tracking and notification scheduling (APNs token-based auth over HTTP/2). Text-only LLM structuring + 11st / Google CSE / Naver Local APIs. Python chosen because the resolver pipeline IS the product and the founder is a stats/ML major.
- Android: later. (Android allows near-0-click screenshot folder monitoring via MediaStore; the 0-click UX matures there first, but not for MVP.)

## MVP scope

IN: share extension capture (+ PHPicker screenshots picker); shopping + place resolvers; card feed; tap card -> verified link or search fallback with up to 3 candidates; in-app map with pins; push (resolved, deadline alerts, price alerts, weekly digest); "not this" feedback.

OUT: full-library auto scan, Android, travel vertical, any social features, generic "second brain" features.

Positioning/marketing must be narrow even though the inbox is universal. Never pitch "an app that remembers everything" (that pitch has killed dozens of apps). Pitch one sentence: "Restaurant from a Reel -> two taps -> on your map" or "Screenshot a product -> we tell you when it goes on sale."

## Validation plan (first 100 users)

Primary metrics (push-model, replaces earlier pull-model metrics):

- Notification CTR and notification -> real action conversion (bought it, went there). These two decide everything.
- Activation: % of users saving 10+ items in week 1. Pass >= 40%; < 20% means even 2-tap capture is too much friction (diagnose: UX vs indifference).
- Week-4 retention >= 25-30% (friend-heavy traffic, so bar is set high).
- Sean Ellis test at 2+ weeks: >= 40% "very disappointed" = signal.
- Cohorts over averages: 15-20 users returning 2x/week voluntarily beats 60 lukewarm users. If found, interview all of them for the target definition.
- Always split friend traffic vs organic. Friend numbers lie.

Pre-registered kill criteria (write before launch, e.g.): "If at week 4 notification CTR < X% and obsessive cohort < 10 users, reject this problem definition and pivot." No post-hoc interpretation.

Pre-build research still open:

- Album autopsy (5 people): what share of their screenshots are trigger-embedded (deadline/price/date)? Coding sheet: source app / content type / trigger presence per screenshot. Hypothesis: majority. Founder's own album (n=1) was ~90% shopping intent with embedded triggers; no published study quantifies trigger share, so this data is the thesis test.
- Mom Test interviews (10): past retrieval-failure stories only, no hypotheticals. < 3 concrete stories = weak pain signal.

## Competitive landscape (2026)

- Platform-native threat: iOS 26 Visual Intelligence on screenshots; Google Pixel Screenshots (Gemini Nano, on-device, smart collections, action chips). In-the-moment actions (event -> calendar, product -> image search) are OS-commoditized; later-in-time resurfacing is the open layer. Do not compete on capture+organize.
- US indie flood: Sorti (closest; AI taste agent auto-sorting reels/screenshots into recipes/products/outfits/places, free, iOS+Android) already ships resurfacing too: price-drop push, restock alerts, coupon surfacing. "Resurfacing" alone is not the differentiator. Others: SnapStash, Captr, MarkIt, MyMind ($6.99/mo premium).
- Korea: 딸깍 (Studio Fore) is the share-sheet archiving incumbent (~50k users claimed; no push, no price tracking, no map; commerce linking announced, not shipped). SsokPin (link-share based, places only, Naver/Kakao integrated), SnapVault (enterprise focus). Consumer horizontal space is open.
- Differentiation: Korean commerce coverage of the action layer — verified 11st/Naver/official-store links, deadline alerts from Korean sale copy, Naver Maps pins — not organization and not resurfacing in the abstract.
- Behavioral competitor in Korea: "KakaoTalk message to self" habit.

## Working conventions

- Founder: Andrew, CMU Statistics & ML, building with a small student team.
- Explanations/discussion: Korean. Code, comments, commit messages, docs: English.
- Style: concise, step-by-step, direct. No verbose padding.
- Prefer showing reasoning and tradeoffs over silently choosing.
