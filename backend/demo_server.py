"""Demo server: runs the full capture -> card loop with canned data so the
product flow is visible without any API keys.

Run: cd backend && uv run uvicorn demo_server:app --port 8000

Uploaded screenshots alternate between resolving as a demo shopping card and a
demo place card. No LLM and no external APIs are called. Links are only the
deterministic fallback URLs the real pipeline would use (Naver search / Naver
map search), never fabricated product links — so nothing unverified is ever
presented as a product match, same as production rules.

Demo data is written to backend/data/demo.db, separate from the real DB.
"""

from pathlib import Path

from app.config import Settings
from app.main import create_app
from app.pipeline.extraction import CaptureExtraction
from app.pipeline.search.base import PlaceResult
from app.pipeline.search.fake import FakeSearchClient

_BACKEND_DIR = Path(__file__).resolve().parent

_SHOPPING = CaptureExtraction(
    kind="shopping",
    visible_domain="demo.example",
    product_name="뉴에라 볼캡 (DEMO)",
    brand="New Era",
    price=39000,
    currency="KRW",
    deadline_text="세일 마감 임박 (DEMO)",
)

_PLACE = CaptureExtraction(
    kind="place",
    place_name="어니언 성수 (DEMO)",
    area_hint="성수동",
    category="카페",
)


class DemoExtractor:
    """Alternates shopping/place extractions instead of calling the VLM."""

    def __init__(self) -> None:
        self._calls = 0

    def extract(
        self, image_bytes: bytes, media_type: str, source_hint: str | None = None
    ) -> CaptureExtraction:
        self._calls += 1
        return _SHOPPING if self._calls % 2 == 1 else _PLACE


_search = FakeSearchClient(
    # No shopping candidates -> the shopping resolver takes its deterministic
    # Naver search-results fallback (verified=false), exactly as in production
    # when nothing passes verification.
    results=[],
    place_results=[
        PlaceResult(
            name="어니언 성수 (DEMO)",
            url=None,  # None -> resolver builds the deterministic map search URL
            category="카페,디저트",
            address="서울 성동구 아차산로9길 8",
            lat=37.5446,
            lng=127.0577,
        )
    ],
)

app = create_app(
    Settings(
        database_url=f"sqlite:///{_BACKEND_DIR / 'data' / 'demo.db'}",
        data_dir=_BACKEND_DIR / "data" / "demo_captures",
    ),
    extractor=DemoExtractor(),
    search_client=_search,
    local_client=_search,
)
