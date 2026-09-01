import base64

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.pipeline.extraction import CaptureExtraction, FakeExtractor
from app.pipeline.search.fake import FakeSearchClient

# Valid 1x1 PNG.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture
def png_upload():
    return {"image": ("capture.png", PNG_BYTES, "image/png")}


@pytest.fixture
def make_client(tmp_path):
    """Build a TestClient wired with fakes: no network, no API keys."""
    created = []

    def _make(
        extraction: CaptureExtraction,
        search_results=None,
        place_results=None,
        pages: dict[str, str] | None = None,
    ) -> TestClient:
        settings = Settings(
            _env_file=None,
            anthropic_api_key=None,
            database_url=f"sqlite:///{tmp_path / 'test.db'}",
            data_dir=tmp_path / "captures",
        )
        fake_search = FakeSearchClient(results=search_results, place_results=place_results)
        page_map = pages or {}

        def fake_fetch(url: str) -> str:
            if url not in page_map:
                raise RuntimeError(f"unexpected fetch in test: {url}")
            return page_map[url]

        app = create_app(
            settings,
            extractor=FakeExtractor(extraction),
            search_client=fake_search,
            local_client=fake_search,
            fetch_fn=fake_fetch,
        )
        client = TestClient(app)
        client.__enter__()  # run lifespan (creates tables + data dir)
        created.append(client)
        return client

    yield _make
    for client in created:
        client.__exit__(None, None, None)
