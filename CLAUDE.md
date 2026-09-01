# Capture Inbox (working name)

Screenshot-based capture inbox that resurfaces saved intent at the right moment. Users share any screenshot in 2 taps. The app extracts what it is and, more importantly, WHEN to bring it back: sale/deadline alerts for shopping, map pins for places. Push-first product, not a destination app.

## Core thesis (do not lose this)

- People screenshot "ambiguously important" info constantly. Saved items are almost never revisited (research: ~16% of saved bookmarks are ever retrieved).
- Saving itself is the psychological reward. Retrieval requires a trigger, and no trigger exists. Storage apps become graveyards.
- Therefore the product is NOT organization. It is resurfacing. Value = the app reaches out (push) at the moment of relevance. Benchmark: flight price alerts, Karrot keyword alerts. Nobody opens those apps daily; everybody taps the push.
- Wedge: shopping intents with embedded triggers (deadlines, prices, sales) and places seen in Reels/Shorts (text can't be copied there). These are the only painkiller segments. Everything else is a generic fallback, not the pitch.
- DAU is explicitly NOT a goal. This app is healthy at 1-2 opens/week if notification CTR and action conversion are high.

## Architecture: universal inbox, vertical resolvers

Inbox accepts anything (share extension). A classifier routes each capture to a resolver pipeline.

### 1. Shopping resolver

- Extract via OCR/VLM: domain, product name, price, currency, deadline text ("7-day group buy", "sale ends", release dates).
- Identification confidence tiers:
  - HIGH: domain + product name visible (most commerce screenshots) -> direct site search.
  - MEDIUM: brand handle only (e.g. Instagram seller post).
  - LOW: image only -> visual search, present as "similar results", never as a definitive match.
- Link resolution rules (CRITICAL):
  - The LLM NEVER generates URLs. LLM output is used only to build search queries. Candidate links come exclusively from search API results (Naver Search/Shopping API, Google Custom Search).
  - Server-side verification loop before any link is shown: fetch the candidate page, confirm extracted product name/price actually appear on it. Match -> verified link. No match -> fall back to a search-results link. Never ship an unverified "confident" link.
  - Safety: domain allowlist (Naver, Kakao, official store domains first), Google Safe Browsing check, link preview showing the domain before opening.
- Price tracking worker: for verified product URLs, poll periodically, parse price/stock, fire push on drop/sale/restock. Known hard parts: option-level prices (color/size), page structure changes, bot blocking. Coverage order: Naver SmartStore (API) -> Coupang (Partners API) -> independent malls (custom scraping, later).
- Monetization path: affiliate commission on push -> purchase.

### 2. Place resolver

- Extract place name + area from Reels/Shorts/blog screenshots.
- Query Naver Local Search API -> coordinates, address, place info.
- Save as pin on in-app map (Naver or Kakao Maps SDK). Tap pin -> deep link to the place page in Naver Maps.
- Target experience: "saw a restaurant in a Reel, two taps, it's a pin on my map."

### 3. Generic fallback

- OCR everything, store as a searchable card. Weekly digest push only. Do not over-invest here; dateless "someday" intent is disposable by nature.

## Notification precision rule

Precision >> recall. Two or three wrong alerts and users disable notifications, which kills the product. When uncertain, send nothing or send a low-commitment digest item, never a confident wrong alert. Every card has a "not this" button; wrong-link rate is a first-class quality metric.

## Tech stack (decided)

- iOS native: Swift + SwiftUI. Reasons: the hard 20% (share extension, PhotoKit, background tasks, push) is native regardless of framework; Flutter would add a plugin-glue layer without covering the hard parts. Validation cohort is iPhone-heavy (Korean 20s).
- Photo access facts (verified):
  - There is NO screenshots-only permission on iOS. Limited access = manual per-photo selection, cannot automate, and iOS 17+ periodically re-prompts.
  - Auto-scan requires Full access + code-level filtering (PHAsset mediaSubtype == .photoScreenshot). All analysis messaging: on-device / screenshots only.
  - No instant processing at capture time; process on app open or via Background App Refresh. UX: "organized N new screenshots" on open.
- MVP capture path is the share extension (2 taps). Full-library auto-scan is a later feature. Share-extension friction doubles as a willingness-to-pay signal.
- Backend: Python + FastAPI. Workers for price tracking and notification scheduling. VLM extraction + Naver Search/Local APIs. Python chosen because the resolver pipeline IS the product and the founder is a stats/ML major.
- Android: later. (Android allows near-0-click screenshot folder monitoring via MediaStore; the 0-click UX matures there first, but not for MVP.)

## MVP scope

IN: share extension capture; shopping + place resolvers; card feed; tap card -> verified link; in-app map with pins; push (deadline alerts, price alerts, weekly digest); "not this" feedback.

OUT: full-library auto scan, Android, any social features, generic "second brain" features.

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

- Album autopsy (5 people): what share of their screenshots are trigger-embedded (deadline/price/date)? Hypothesis: majority. Founder's own album (n=1) was ~90% shopping intent with embedded triggers.
- Mom Test interviews (10): past retrieval-failure stories only, no hypotheticals. < 3 concrete stories = weak pain signal.

## Competitive landscape (2026)

- Platform-native threat: iOS 26 Visual Intelligence on screenshots; Google Pixel Screenshots (Gemini Nano, on-device, smart collections, action chips). Capture+organize is commoditized; do not compete there.
- US indie flood: Sorti (closest: AI taste agent auto-sorting reels/screenshots into recipes/products/outfits/places, free, iOS+Android), SnapStash, Captr, MarkIt, MyMind ($6.99/mo premium), etc.
- Korea: SsokPin (link-share based, places only, Naver/Kakao integrated), SnapVault (enterprise focus). Consumer horizontal space is open.
- Differentiation: the resurfacing/action layer (triggers, price tracking, verified links, Korean commerce + Naver Maps integration), not organization.
- Behavioral competitor in Korea: "KakaoTalk message to self" habit.

## Working conventions

- Founder: Andrew, CMU Statistics & ML, building with a small student team.
- Explanations/discussion: Korean. Code, comments, commit messages, docs: English.
- Style: concise, step-by-step, direct. No verbose padding.
- Prefer showing reasoning and tradeoffs over silently choosing.
