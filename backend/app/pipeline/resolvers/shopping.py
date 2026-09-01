from urllib.parse import urlparse

from app.pipeline.classifier import derive_confidence
from app.pipeline.extraction import CaptureExtraction
from app.pipeline.retailers import Retailer, is_retailer_url, match_retailer
from app.pipeline.search.base import SearchClient, SearchResult
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


def rank_candidates(
    candidates: list[SearchResult],
    retailer: Retailer | None,
    store_name: str | None,
) -> list[SearchResult]:
    """Verify same-retailer candidates first: when the screenshot shows where
    the user was shopping, a match on that retailer beats a match elsewhere."""

    def score(candidate: SearchResult) -> int:
        value = 0
        if retailer is not None and is_retailer_url(retailer, candidate.url):
            value += 2
        # Naver Shopping API puts the mall name in the snippet field.
        if store_name and candidate.snippet:
            if store_name.lower() in candidate.snippet.lower():
                value += 1
        return value

    return sorted(candidates, key=score, reverse=True)  # sorted() is stable


def resolve_shopping(
    extraction: CaptureExtraction, search_client: SearchClient, fetch_fn: FetchFn
) -> ShoppingPayload:
    query = build_search_query(extraction)
    retailer = match_retailer(extraction.visible_domain)

    link: Link | None = None
    try:
        candidates = search_client.search(query, limit=_MAX_CANDIDATES * 2)
    except Exception:
        candidates = []
    ranked = rank_candidates(candidates, retailer, extraction.store_name)
    for candidate in ranked[:_MAX_CANDIDATES]:
        if verify_candidate(fetch_fn, candidate.url, extraction):
            link = Link(
                url=candidate.url,
                domain=urlparse(candidate.url).netloc,
                verified=True,
                kind="product",
            )
            break

    if link is None:
        # No verified match -> deterministic search-results fallback, never an
        # unverified link presented as a product link. When the screenshot
        # showed a known retailer, fall back to that retailer's own search.
        fallback_url = (
            retailer.search_url(query) if retailer else build_search_fallback_url(query)
        )
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
