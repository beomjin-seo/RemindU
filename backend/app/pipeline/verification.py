import re
from typing import Callable
from urllib.parse import urlencode

import httpx

from app.pipeline.extraction import CaptureExtraction

FetchFn = Callable[[str], str]

_TIMEOUT = 10.0
_MAX_BYTES = 512 * 1024
_TOKEN_OVERLAP_THRESHOLD = 0.6


def default_fetch(url: str) -> str:
    with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                chunks.append(chunk)
                total += len(chunk)
                if total >= _MAX_BYTES:
                    break
            return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")


def tokenize(text: str) -> set[str]:
    return set(re.findall(r"[0-9a-z가-힣]+", text.lower()))


def token_overlap(needle: str, haystack_tokens: set[str]) -> float:
    needle_tokens = tokenize(needle)
    if not needle_tokens:
        return 0.0
    return len(needle_tokens & haystack_tokens) / len(needle_tokens)


def _price_variants(price: int) -> set[str]:
    return {str(price), f"{price:,}"}


def is_safe_candidate_url(url: str) -> bool:
    # Link-safety gate (per CLAUDE.md) that every candidate URL must pass
    # BEFORE it can be fetched or shipped as a verified product link:
    # TODO: domain allowlist — Naver, Kakao, and official store domains first;
    #       unknown domains fall back to search_results, not a product link.
    # TODO: Google Safe Browsing lookup on the candidate URL.
    # Stub returns True (candidates already come only from trusted search
    # APIs, never from LLM output); tighten before real traffic.
    return True


def verify_candidate(fetch_fn: FetchFn, url: str, extraction: CaptureExtraction) -> bool:
    # Invariant 2: fetch the candidate page and confirm the extracted product
    # name (token overlap) and/or price actually appear in the page text.
    # Any fetch failure means unverified — never a verified link.
    if not is_safe_candidate_url(url):
        return False
    try:
        page_text = fetch_fn(url)
    except Exception:
        return False

    page_tokens = tokenize(page_text)
    if extraction.product_name:
        if token_overlap(extraction.product_name, page_tokens) >= _TOKEN_OVERLAP_THRESHOLD:
            return True
    if extraction.price is not None:
        if any(variant in page_text for variant in _price_variants(extraction.price)):
            return True
    return False


def build_search_fallback_url(query: str) -> str:
    # Deterministically constructed search-results URL — never LLM output.
    return "https://search.shopping.naver.com/search/all?" + urlencode({"query": query})
