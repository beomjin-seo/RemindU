from urllib.parse import urlparse

from app.pipeline.classifier import derive_confidence
from app.pipeline.extraction import CaptureExtraction
from app.pipeline.search.base import SearchClient
from app.pipeline.verification import FetchFn, build_search_fallback_url, verify_candidate
from app.schemas import Link, ShoppingPayload

_MAX_CANDIDATES = 3


def build_search_query(extraction: CaptureExtraction) -> str:
    # LLM output is used only to build search queries, never URLs.
    name = extraction.product_name or ""
    brand = extraction.brand or ""
    if brand and brand.lower() not in name.lower():
        return f"{brand} {name}".strip()
    return name or brand


def resolve_shopping(
    extraction: CaptureExtraction, search_client: SearchClient, fetch_fn: FetchFn
) -> ShoppingPayload:
    query = build_search_query(extraction)

    link: Link | None = None
    try:
        candidates = search_client.search(query, limit=_MAX_CANDIDATES)
    except Exception:
        candidates = []
    for candidate in candidates[:_MAX_CANDIDATES]:
        if verify_candidate(fetch_fn, candidate.url, extraction):
            link = Link(
                url=candidate.url,
                domain=urlparse(candidate.url).netloc,
                verified=True,
                kind="product",
            )
            break

    if link is None:
        # No verified match -> deterministic search-results fallback,
        # never an unverified link presented as a product link.
        fallback_url = build_search_fallback_url(query)
        link = Link(
            url=fallback_url,
            domain=urlparse(fallback_url).netloc,
            verified=False,
            kind="search_results",
        )

    return ShoppingPayload(
        product_name=extraction.product_name or query,
        brand=extraction.brand,
        price=extraction.price,
        currency=extraction.currency or "KRW",
        deadline_text=extraction.deadline_text,
        # TODO: parse deadline_text into deadline_at so the notifications
        # worker's deadline alerts have a data source. Conservative parsing
        # only (precision >> recall): set deadline_at solely when the text is
        # unambiguous (explicit date/time); otherwise leave None — a missed
        # deadline alert is better than a wrong one.
        deadline_at=None,
        confidence=derive_confidence(extraction),
        link=link,
    )
