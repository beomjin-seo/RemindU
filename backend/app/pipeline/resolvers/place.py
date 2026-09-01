from urllib.parse import quote

from app.pipeline.extraction import CaptureExtraction
from app.pipeline.search.base import LocalSearchClient
from app.schemas import PlacePayload


def build_map_search_url(query: str) -> str:
    # Deterministic Naver Maps search URL, used when the search API returns
    # no direct place link.
    return f"https://map.naver.com/p/search/{quote(query)}"


def resolve_place(extraction: CaptureExtraction, local_client: LocalSearchClient) -> PlacePayload:
    name = extraction.place_name or ""
    query = f"{extraction.area_hint} {name}".strip() if extraction.area_hint else name

    try:
        results = local_client.search_places(query, limit=5)
    except Exception:
        results = []

    if not results:
        return PlacePayload(name=name, naver_place_url=build_map_search_url(query))

    top = results[0]
    return PlacePayload(
        name=top.name or name,
        category=top.category or extraction.category,
        address=top.address,
        lat=top.lat,
        lng=top.lng,
        naver_place_url=top.url or build_map_search_url(query),
    )
