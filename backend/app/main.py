from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.api import captures, cards, devices
from app.config import Settings
from app.db import create_tables, make_engine, make_session_factory
from app.pipeline.extraction import AnthropicExtractor, Extractor
from app.pipeline.runner import PipelineDeps
from app.pipeline.search.base import LocalSearchClient, SearchClient
from app.pipeline.search.naver import NaverLocalClient, NaverShoppingClient
from app.pipeline.verification import FetchFn, default_fetch


def create_app(
    settings: Settings | None = None,
    *,
    extractor: Extractor | None = None,
    search_client: SearchClient | None = None,
    local_client: LocalSearchClient | None = None,
    fetch_fn: FetchFn | None = None,
) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    deps = PipelineDeps(
        extractor=extractor
        or AnthropicExtractor(model=settings.extractor_model, api_key=settings.anthropic_api_key),
        search_client=search_client
        or NaverShoppingClient(settings.naver_client_id, settings.naver_client_secret),
        local_client=local_client
        or NaverLocalClient(settings.naver_client_id, settings.naver_client_secret),
        fetch_fn=fetch_fn or default_fetch,
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

    app.include_router(captures.router)
    app.include_router(cards.router)
    app.include_router(devices.router)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
