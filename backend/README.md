# Capture Inbox Backend

FastAPI backend for the Capture Inbox: screenshot upload -> VLM extraction ->
classification -> vertical resolvers (shopping / place / generic) -> cards.
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

- `ANTHROPIC_API_KEY` — VLM extraction
- `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` — Naver Shopping + Local search
- `GOOGLE_CSE_KEY` / `GOOGLE_CSE_CX` — optional Google Custom Search

## Run tests

No network and no API keys needed (fake extractor / search / fetch):

```sh
uv run pytest
```

## Workers

Runnable skeletons (loop structure + conservative alert logic; parsers and
APNs delivery are stubs):

```sh
uv run python -m app.workers.price_tracker
uv run python -m app.workers.notifications
```

## Layout

- `app/main.py` — `create_app()` factory, router wiring, `/healthz`
- `app/api/` — HTTP endpoints (captures, cards, devices)
- `app/pipeline/` — extraction (Anthropic VLM), classifier, search clients,
  link verification, resolvers, and the capture runner
- `app/workers/` — price tracker and notification worker skeletons
- `tests/` — HTTP-level pipeline tests with fakes
