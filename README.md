# Capture Inbox

Screenshot-based capture inbox that resurfaces saved intent at the right moment. Share any screenshot in 2 taps; the app extracts what it is and when to bring it back (sale/deadline alerts for shopping, map pins for places). See [CLAUDE.md](CLAUDE.md) for the full product spec and [docs/api.md](docs/api.md) for the API contract.

## Layout

- `backend/` — FastAPI server: capture upload, classifier → shopping/place/generic resolvers, link verification loop, price-tracking and notification worker skeletons
- `ios/` — SwiftUI app (Inbox / Map / Settings) + share extension (2-tap capture)
- `sample screenshots/` — real screenshot fixtures for resolver testing

## Backend

```bash
cd backend
uv sync
uv run pytest            # no network or API keys needed
uv run uvicorn app.main:app   # serves on :8000
```

Copy `backend/.env.example` to `backend/.env` and fill in `ANTHROPIC_API_KEY` (VLM extraction) and Naver/Google keys (search) to enable real resolution; without keys the server boots but captures resolve to `failed`.

## iOS

The Xcode project is generated, not committed:

```bash
brew install xcodegen   # once
cd ios
xcodegen generate
open CaptureInbox.xcodeproj
```

Build/run the `CaptureInbox` scheme on an iPhone simulator. The app talks to `http://localhost:8000` by default (changeable in Settings).
