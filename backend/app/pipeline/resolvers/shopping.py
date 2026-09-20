from datetime import datetime
from urllib.parse import urlparse

from app.pipeline.classifier import derive_confidence
from app.pipeline.deadlines import SEOUL, parse_deadline
from app.pipeline.extraction import CaptureExtraction
from app.pipeline.retailers import Retailer, is_retailer_url, match_retailer
from app.pipeline.search.base import SearchClient, SearchResult
from app.pipeline.trust import is_trusted_domain
from app.pipeline.verification import FetchFn, build_search_fallback_url, verify_candidate
from app.schemas import Candidate, Link, ShoppingPayload

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
        # Search clients put the mall/seller name in the snippet field.
        if store_name and candidate.snippet:
            if store_name.lower() in candidate.snippet.lower():
                value += 1
        return value

    return sorted(candidates, key=score, reverse=True)  # sorted() is stable


def _verify_top_candidates(
    ranked: list[SearchResult], extraction: CaptureExtraction, fetch_fn: FetchFn
) -> list[Candidate]:
    # Every candidate URL comes from a search API result; verification is
    # attempted on each of the top _MAX_CANDIDATES and recorded per candidate.
    candidates: list[Candidate] = []
    for result in ranked[:_MAX_CANDIDATES]:
        domain = urlparse(result.url).netloc
        candidates.append(
            Candidate(
                url=result.url,
                domain=domain,
                title=result.title,
                verified=verify_candidate(
                    fetch_fn, result.url, extraction, result_price=result.price
                ),
                trusted=is_trusted_domain(domain),
                kind="product",
            )
        )
    return candidates


def resolve_shopping(
    extraction: CaptureExtraction, search_client: SearchClient, fetch_fn: FetchFn
) -> ShoppingPayload:
    query = build_search_query(extraction)
    retailer = match_retailer(extraction.visible_domain)

    try:
        results = search_client.search(query, limit=_MAX_CANDIDATES * 2)
    except Exception:
        results = []
    ranked = rank_candidates(results, retailer, extraction.store_name)
    candidates = _verify_top_candidates(ranked, extraction, fetch_fn)

    verified = next((candidate for candidate in candidates if candidate.verified), None)
    if verified is not None:
        link = Link(
            url=verified.url,
            domain=verified.domain,
            verified=True,
            kind="product",
            trusted=verified.trusted,
        )
    else:
        # No verified match -> deterministic search-results fallback, never an
        # unverified link presented as a product link. When the screenshot
        # showed a known retailer, fall back to that retailer's own search.
        fallback_url = (
            retailer.search_url(query) if retailer else build_search_fallback_url(query)
        )
        fallback_domain = urlparse(fallback_url).netloc
        link = Link(
            url=fallback_url,
            domain=fallback_domain,
            verified=False,
            kind="search_results",
            trusted=is_trusted_domain(fallback_domain),
        )

    return ShoppingPayload(
        product_name=extraction.product_name or query,
        brand=extraction.brand,
        price=extraction.price,
        currency=extraction.currency or "KRW",
        deadline_text=extraction.deadline_text,
        # Explicit dates only (precision >> recall); relative text stays None
        # and never schedules a deadline alert.
        deadline_at=parse_deadline(extraction.deadline_text, datetime.now(SEOUL)),
        confidence=derive_confidence(extraction),
        link=link,
        candidates=candidates,
    )
