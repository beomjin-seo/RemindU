# Capture Inbox API Contract

Base path: `/v1`. Server default port: `8000`.

All request and response bodies are JSON unless noted. Timestamps are ISO 8601.

## Endpoints

### POST /v1/captures

Upload a screenshot for processing.

- Content type: `multipart/form-data`
- Fields:
  - `image` (file, required)
  - `source_hint` (string, optional)
- Returns `201`:

```json
{"capture_id": "…", "status": "processing"}
```

Processing runs asynchronously via FastAPI `BackgroundTasks`; the client polls
`GET /v1/captures/{capture_id}` until the status changes.

### GET /v1/captures/{capture_id}

```json
{"capture_id": "…", "status": "processing" | "resolved" | "failed", "card_id": "…" | null}
```

`card_id` is set once the capture resolves into a card. A failed pipeline sets
`status = "failed"` and never produces a fake-confident card.

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

Returns `204`. Push registration stub.

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
  "deadline_at": "2026-09-07T00:00:00Z" | null,
  "confidence": "high" | "medium" | "low",
  "link": {
    "url": "…",
    "domain": "…",
    "verified": true | false,
    "kind": "product" | "search_results"
  }
}
```

Link rules (product invariants):

- The LLM never generates URLs. Candidate links come exclusively from search
  API results; fallback links are deterministically constructed search-results
  URLs.
- A link is `verified: true, kind: "product"` only after server-side
  verification: the candidate page was fetched and the extracted product name
  (token overlap) and/or price were confirmed to appear in the page text.
- No match or fetch failure falls back to a search-results link with
  `verified: false, kind: "search_results"`. An unverified link is never
  shipped as `kind: "product"`.

Confidence tiers:

- `high`: visible domain + product name were both read from the screenshot.
- `medium`: brand/handle only.
- `low`: image only — present as similar results, never as a definitive match.

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
