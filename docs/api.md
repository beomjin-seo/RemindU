# Capture Inbox API Contract

Base path: `/v1`. Server default port: `8000`.

All request and response bodies are JSON unless noted. Timestamps are ISO 8601.

## Authentication

Every `/v1` request carries an `X-Install-Id` header: an opaque per-install
id (the app uses `identifierForVendor`, shared with its share extension).
Captures, cards, and device tokens are scoped to that id; a missing or empty
header is `401`, and another install's card reads as `404`. There are no
user accounts in the MVP.

## Endpoints

### POST /v1/captures

Upload a screenshot for processing.

- Content type: `multipart/form-data`
- Fields:
  - `image` (file, required): `image/jpeg` or `image/png`
  - `source_hint` (string, optional)
  - `ocr_text` (string, optional): newline-separated text lines recognized
    on-device (iOS Vision framework), in reading order. Clients should always
    send it when recognition produced anything.
- Returns `201`:

```json
{"capture_id": "…", "status": "processing"}
```

Processing runs asynchronously via FastAPI `BackgroundTasks`; the client polls
`GET /v1/captures/{capture_id}` until the status changes.

Privacy (extraction path):

- `ocr_text` is the default extraction input. When it contains at least 8
  non-space characters the server structures the text with a text-only model
  call; the screenshot pixels are never sent to any external AI API.
- Without usable `ocr_text`, the server analyzes the image itself only if it
  runs with `ALLOW_IMAGE_EXTRACTION=true` (default `false`). Otherwise the
  capture fails with `failure_reason: "no_text"`.

### GET /v1/captures/{capture_id}/image

Returns the stored screenshot bytes for a capture (`image/jpeg` or
`image/png`). Used by clients to render card thumbnails.

### GET /v1/captures/{capture_id}

```json
{
  "capture_id": "…",
  "status": "processing" | "resolved" | "failed",
  "card_id": "…" | null,
  "failure_reason": "…" | null
}
```

`card_id` is set once the capture resolves into a card. A failed pipeline sets
`status = "failed"` and never produces a fake-confident card.

`failure_reason` is non-null only when `status == "failed"`:

- `"no_text"`: no usable `ocr_text` and image extraction is disabled. Clients
  can prompt the user to retry with on-device text recognition.
- `"extraction_failed"`: the model call failed or refused.
- `"pipeline_failed"`: a later stage (classification/resolution) failed.

Treat unknown values as a generic failure.

### GET /v1/cards

Query parameters:

- `type` (optional): `shopping` | `place` | `generic`
- `limit` (optional int, default 20, max 100)
- `cursor` (optional string): opaque cursor from a previous page

Returns cards newest first:

```json
{"cards": [Card], "next_cursor": "…" | null}
```

### GET /v1/cards/{card_id}

Returns a single `Card`.

### POST /v1/cards/{card_id}/feedback

```json
{"kind": "not_this" | "correct"}
```

Returns `204`. Feedback is stored; wrong-link rate is a first-class quality
metric.

### POST /v1/devices

```json
{"apns_token": "…"}
```

Returns `204`. Idempotent for the same token. A token APNs later reports as
unregistered (HTTP 410) is deleted server-side; the app re-registers on next
launch.

### GET /healthz

```json
{"status": "ok"}
```

## Card shape

```json
{
  "id": "…",
  "capture_id": "…",
  "type": "shopping" | "place" | "generic",
  "status": "resolved" | "failed",
  "title": "…",
  "created_at": "2026-08-31T12:00:00Z",
  "shopping": ShoppingPayload | null,
  "place": PlacePayload | null,
  "generic": GenericPayload | null
}
```

Exactly one of `shopping` / `place` / `generic` is non-null, matching `type`.

### ShoppingPayload

```json
{
  "product_name": "…",
  "brand": "…" | null,
  "price": 129000 | null,
  "currency": "KRW",
  "deadline_text": "…" | null,
  "deadline_at": "2026-09-12T23:59:00+09:00" | null,
  "confidence": "high" | "medium" | "low",
  "link": {
    "url": "…",
    "domain": "…",
    "verified": true | false,
    "kind": "product" | "search_results",
    "trusted": true | false
  },
  "candidates": [
    {
      "url": "…",
      "domain": "…",
      "title": "…",
      "verified": true | false,
      "trusted": true | false,
      "kind": "product" | "search_results"
    }
  ]
}
```

Link rules (product invariants):

- The LLM never generates URLs. Candidate links come exclusively from search
  API results; fallback links are deterministically constructed search-results
  URLs.
- `link` is the best link: the first verified candidate, else the
  search-results fallback (the known retailer's own search page when the
  screenshot showed one, otherwise Naver integrated search).
- A link is `verified: true, kind: "product"` only after server-side
  verification: the candidate page was fetched and the extracted product name
  (token overlap) and/or price were confirmed to appear in the page text.
- No match or fetch failure falls back to a search-results link with
  `verified: false, kind: "search_results"`. An unverified `link` is never
  shipped as `kind: "product"`.
- `candidates` lists the top-ranked search results (max 3, may be empty) that
  verification was attempted on, in ranked order, each with its own
  `verified` flag. Clients must present `verified: false` candidates as
  "similar results", never as the definitive match.
- `trusted: true` means the domain is on the server-side allowlist of
  well-known retailers/portals (Naver, Kakao, Coupang, Musinsa, 11st, …).
  Clients render it as a safety badge; it is independent of `verified`.

Confidence tiers:

- `high`: visible domain + product name were both read from the screenshot.
- `medium`: brand/handle only.
- `low`: image only — present as similar results, never as a definitive match.

Clients show link confidence as one of three states (verified product link /
similar results / search results), never as a percentage.

Deadline semantics:

- `deadline_text` is the phrase as read from the screenshot (may be relative:
  "7일간", "곧 마감").
- `deadline_at` is set only when that text contains an explicit calendar date
  ("9월 12일까지", "9/12 마감", "2026.09.12", "until Sep 12"). Time defaults
  to 23:59 KST; an explicit time ("오후 6시", "18:00") is used when present.
  Relative or ambiguous text ("오늘까지", "D-3", "7일간") leaves it `null`,
  and a `null` deadline never produces a deadline alert.
- Year-less dates take the current year, rolling to the next year when the
  result would be more than 7 days in the past.
- Always serialized with the `+09:00` (Asia/Seoul) offset.

Search backbone note: the Naver Shopping search API was permanently
terminated on 2026-07-31. Shopping candidates now come from the 11st OpenAPI
ProductSearch (`ELEVENST_API_KEY`) merged with Google Custom Search restricted
to the trusted-domain allowlist (`GOOGLE_CSE_KEY` / `GOOGLE_CSE_CX`); a
missing key skips that source. Naver Local Search (places) is unaffected.

### PlacePayload

```json
{
  "name": "…",
  "category": "…" | null,
  "address": "…" | null,
  "lat": 37.5776 | null,
  "lng": 126.9852 | null,
  "naver_place_url": "…" | null
}
```

`naver_place_url` comes from the Naver Local Search API result link, or a
deterministic Naver Maps search URL as fallback.

### GenericPayload

```json
{"ocr_text": "…", "summary": "…" | null}
```

## Push payload (APNs)

```json
{
  "aps": {"alert": {"title": "…", "body": "…"}, "sound": "default"},
  "card_id": "…",
  "kind": "resolved" | "deadline" | "price" | "digest"
}
```

`card_id` identifies the card to open on tap; for `kind: "digest"` it is `""`.

Kinds and when they fire (all times KST):

| kind | trigger | title / body |
| --- | --- | --- |
| `resolved` | right after a capture becomes a card (`PUSH_ON_RESOLVED=true`) | `찾았어요: {title}` / price · domain, address, or summary |
| `deadline` | shopping card with `deadline_at` within the next 36h, sent during the 19:30–21:30 window the evening before (D-1 20:00 slot) | `내일 마감: {product_name}` / `{deadline_text} · {domain}` |
| `price` | verified product link, high confidence, current price ≥ 10% below the captured price | `가격 인하: {product_name}` / `지금 {price} · {domain}` |
| `digest` | Sunday 19:30–21:30, at most once per 6 days, only if ≥ 1 card was created in the last 7 days | `이번 주 저장 {N}개` / up to 3 newest titles joined with ` · ` |

Precision >> recall: an alert is sent only when every condition positively
holds (explicit date, verified link, high confidence, known prices); unknown
data sends nothing, and an empty digest is never sent. Every trigger is
recorded in `notification_log` (unique on `card_id` + `kind`) before delivery,
so the same card never receives the same kind twice — including at most one
`price` alert per card.

Delivery: APNs token-based auth (ES256 provider JWT, `iss` = team id, `kid`
header = key id, cached 50 minutes) over HTTP/2 with headers `apns-topic`
(bundle id), `apns-push-type: alert`, `apns-priority: 10`. Settings:
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY_PATH`, `APNS_BUNDLE_ID`
(default `com.captureinbox.app`), `APNS_USE_SANDBOX` (default `true`). When
unset, the sender logs the payload and reports `unconfigured`; it never
raises. HTTP 410 (`Unregistered`) deletes the device row.

Client behavior (iOS): a tap fetches `GET /v1/cards/{card_id}` and presents
the card detail; an empty `card_id` just opens the inbox. Notifications that
arrive while the app is in the foreground are shown as banners. On a
simulator the same JSON can be delivered with
`xcrun simctl push booted com.captureinbox.app payload.json`.
