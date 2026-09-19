from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.api import captures, cards, devices
from app.config import Settings
from app.db import create_tables, make_engine, make_session_factory
from app.pipeline.extraction import (
    AnthropicExtractor,
    Extractor,
    RoutingExtractor,
    TextExtractor,
)
from app.pipeline.runner import PipelineDeps
from app.pipeline.search.base import LocalSearchClient, SearchClient
from app.pipeline.search.composite import CompositeSearchClient
from app.pipeline.search.elevenst import ElevenStClient
from app.pipeline.search.google import GoogleCSEClient
from app.pipeline.search.naver import NaverLocalClient
from app.pipeline.verification import FetchFn, default_fetch
from app.workers.apns import ApnsSender, PushSender


def _default_extractor(settings: Settings) -> Extractor:
    # PRIVACY: text-only structuring of on-device OCR is the default; pixels
    # reach the model only when ALLOW_IMAGE_EXTRACTION is explicitly enabled.
    return RoutingExtractor(
        text_extractor=TextExtractor(
            model=settings.extractor_model, api_key=settings.anthropic_api_key
        ),
        image_extractor=AnthropicExtractor(
            model=settings.extractor_model, api_key=settings.anthropic_api_key
        ),
        allow_image=settings.allow_image_extraction,
    )


def _default_search_client(settings: Settings) -> SearchClient:
    # Naver Shopping search API was terminated 2026-07-31 (see search/naver.py).
    return CompositeSearchClient(
        [
            ElevenStClient(settings.elevenst_api_key),
            GoogleCSEClient(settings.google_cse_key, settings.google_cse_cx, site_restricted=True),
        ]
    )


def create_app(
    settings: Settings | None = None,
    *,
    extractor: Extractor | None = None,
    search_client: SearchClient | None = None,
    local_client: LocalSearchClient | None = None,
    fetch_fn: FetchFn | None = None,
    push_sender: PushSender | None = None,
) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    push_sender = push_sender or ApnsSender.from_settings(settings)
    deps = PipelineDeps(
        extractor=extractor or _default_extractor(settings),
        search_client=search_client or _default_search_client(settings),
        local_client=local_client
        or NaverLocalClient(settings.naver_client_id, settings.naver_client_secret),
        fetch_fn=fetch_fn or default_fetch,
        push_sender=push_sender,
        push_on_resolved=settings.push_on_resolved,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        if settings.database_url.startswith("sqlite:///"):
            Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(
                parents=True, exist_ok=True
            )
        create_tables(engine)
        yield

    app = FastAPI(title="Capture Inbox API", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.deps = deps
    app.state.push_sender = push_sender

    app.include_router(captures.router)
    app.include_router(cards.router)
    app.include_router(devices.router)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
