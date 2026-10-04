# Capture Inbox

Screenshot-based capture inbox that resurfaces saved intent at the right moment. Share any screenshot in 2 taps; the app extracts what it is and when to bring it back (sale/deadline alerts for shopping, map pins for places). See [CLAUDE.md](CLAUDE.md) for the full product spec and [docs/api.md](docs/api.md) for the API contract.

## Layout

- `backend/` — FastAPI server: capture upload, classifier → shopping/place/generic resolvers, link verification loop, price-tracking and notification worker skeletons
- `ios/` — SwiftUI app (Inbox / Map / Settings) + share extension (2-tap capture)
- `sample screenshots/` — real screenshot fixtures for resolver testing
- `ui-prototype/prototype V3/` — preserved Storyge V3 web prototype
- `prototype V3 Mobile/` — separate Storyge V3 iOS/Android prototype built with React Native and Expo

## Storyge V3 prototypes

The web and mobile prototypes are separate snapshots. Existing V2 entry points, the SwiftUI app in `ios/`, and the backend remain unchanged.

- [Web setup and limitations](ui-prototype/prototype%20V3/README.md): serve `ui-prototype/` locally and open `/prototype%20V3/index.html`.
- [Mobile setup and limitations](prototype%20V3%20Mobile/README.md): run `npm ci` and `npm run ios` or `npm run android` from `prototype V3 Mobile/`.
- [Web verification](ui-prototype/prototype%20V3/qa/QA.md) and [mobile verification](prototype%20V3%20Mobile/qa/VERIFICATION.md).

Both prototypes use local storage and sample content. They are not connected to the backend, AI classification, semantic search, screenshot-source lookup, account sync, or OS share intake. The mobile prototype is an Expo Go development app, not a signed store release; it does not replace the existing SwiftUI app. Android runtime verification and the documented dependency security issues remain release blockers.

The mobile source is kept outside `ui-prototype/`, which is the existing GitHub Pages publishing directory. Adding these snapshots does not change the current landing page or deployment workflow.

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
