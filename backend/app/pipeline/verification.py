import re
from typing import Callable
from urllib.parse import urlencode, urlparse

import httpx

from app.pipeline.extraction import CaptureExtraction
from app.pipeline.trust import is_trusted_domain

FetchFn = Callable[[str], str]

_TIMEOUT = 10.0
_MAX_BYTES = 512 * 1024
_TOKEN_OVERLAP_THRESHOLD = 0.6
_TAG_RE = re.compile(r"<[^>]+>")


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


def _price_variants(price: int) -> list[str]:
    return [f"{price:,}", str(price)]


def is_safe_candidate_url(url: str) -> bool:
    # Link-safety gate (CLAUDE.md): only allowlisted retailer/portal domains
    # can be fetched and become a verified product link. Off-list candidates
    # stay listed as unverified "similar results".
    # TODO: Google Safe Browsing lookup on the candidate URL.
    parts = urlparse(url)
    return parts.scheme in ("http", "https") and is_trusted_domain(parts.netloc)


def name_matches(product_name: str, page_tokens: set[str]) -> bool:
    # Token overlap alone lets an "Air Max 90" page pass for "Air Max 97":
    # every numeric token (model number, size, generation) must be present.
    name_tokens = tokenize(product_name)
    if not name_tokens:
        return False
    numeric = {token for token in name_tokens if token.isdigit()}
    if not numeric <= page_tokens:
        return False
    return len(name_tokens & page_tokens) / len(name_tokens) >= _TOKEN_OVERLAP_THRESHOLD


def price_matches(page_text: str, price: int) -> bool:
    """True when the price appears AS a price: next to a currency marker in
    the visible text, or as a price/amount value in markup (JSON-LD,
    og:price). Bare digits anywhere ("order #129000") never count."""
    amounts = "|".join(re.escape(variant) for variant in _price_variants(price))
    visible = _TAG_RE.sub(" ", page_text)
    currency_context = (
        rf"(?:₩|￦|krw|won)\s*(?:{amounts})(?![\d,])"
        rf"|(?<![\d,])(?:{amounts})\s*(?:원|krw|won)"
    )
    markup_context = rf"(?:price|amount)[^0-9<>]{{0,24}}(?<![\d,])(?:{amounts})(?![\d,])"
    return bool(
        re.search(currency_context, visible, re.IGNORECASE)
        or re.search(markup_context, page_text, re.IGNORECASE)
    )


def verify_candidate(
    fetch_fn: FetchFn,
    url: str,
    extraction: CaptureExtraction,
    result_price: int | None = None,
) -> bool:
    # Invariant 2: fetch the candidate page and confirm the extracted product
    # name is on it (numeric tokens required) AND, when the screenshot showed
    # a price, that the same price appears as a price there or the search API
    # reported it for this result. Name is mandatory: a price alone never
    # verifies. Any fetch failure means unverified — never a verified link.
    if not extraction.product_name or not is_safe_candidate_url(url):
        return False
    try:
        page_text = fetch_fn(url)
    except Exception:
        return False

    if not name_matches(extraction.product_name, tokenize(page_text)):
        return False
    if extraction.price is None:
        return True
    return result_price == extraction.price or price_matches(page_text, extraction.price)


def build_search_fallback_url(query: str) -> str:
    # Deterministically constructed search-results URL — never LLM output.
    # Naver integrated search, NOT search.shopping.naver.com: the shopping
    # vertical bot-blocks cold external entries (no cookies/JS history), which
    # breaks the fallback link for real users in an in-app browser.
    return "https://search.naver.com/search.naver?" + urlencode({"query": query})
