# Capture Inbox Backend

FastAPI backend for the Capture Inbox: screenshot + on-device OCR text upload
-> text-only LLM structuring -> classification -> vertical resolvers
(shopping / place / generic) -> cards. Screenshot pixels never leave the
server unless `ALLOW_IMAGE_EXTRACTION=true`.
See `../docs/api.md` for the API contract and `../CLAUDE.md` for product
invariants.

## Setup

Requires Python >= 3.13 and [uv](https://docs.astral.sh/uv/).

```sh
cd backend
uv sync
```

## Run the server

```sh
uv run uvicorn app.main:app          # http://127.0.0.1:8000
```

Works without any API keys: `/healthz` and all read endpoints function, and
capture processing fails gracefully (capture status becomes `failed`) until
keys are configured. Copy `.env.example` to `.env` and fill in keys to enable
the real pipeline:

- `ANTHROPIC_API_KEY` — extraction (text-only by default;
  `ALLOW_IMAGE_EXTRACTION=true` enables vision on captures without OCR text)
- `ELEVENST_API_KEY` — 11st ProductSearch, the primary shopping search (the
  Naver Shopping search API was terminated 2026-07-31)
- `GOOGLE_CSE_KEY` / `GOOGLE_CSE_CX` — Google Custom Search restricted to the
  trusted-domain allowlist (optional; merged with 11st results)
- `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` — Naver Local search (places)
- `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_AUTH_KEY_PATH` — APNs token auth
  (`APNS_BUNDLE_ID`, `APNS_USE_SANDBOX=true`); unset -> pushes are logged as
  `unconfigured`, never delivered
- `PUSH_ON_RESOLVED` — "찾았어요" push right after a capture resolves (default
  `true`)

## Run tests

No network and no API keys needed (fake extractor / search / fetch):

```sh
uv run pytest
```

## Workers

```sh
uv run python -m app.workers.notifications   # deadline (D-1 evening) + Sunday digest
uv run python -m app.workers.price_tracker   # price alerts (price parsers still stubs)
```

Every push trigger is written to `notification_log` before delivery, so the
same (card, kind) never fires twice; a digest is only sent when the week
saved something. Deadlines come from `app/pipeline/deadlines.py`, which only
accepts explicit dates (relative text like "7일간" never schedules an alert).
APNs delivery (`app/workers/apns.py`) is HTTP/2 with an ES256 provider JWT
cached for 50 minutes; a 410 response removes the device row.

## Layout

- `app/main.py` — `create_app()` factory, router wiring, `/healthz`
- `app/api/` — HTTP endpoints (captures, cards, devices)
- `app/pipeline/` — extraction (text-first routing, Anthropic), classifier,
  search clients (11st + Google CSE composite, Naver Local), link
  verification, deadline parser, resolvers, and the capture runner
- `app/workers/` — APNs sender, notification worker (deadline/digest/resolved),
  price tracker
- `tests/` — HTTP-level pipeline tests with fakes
