"""Known-retailer registry for domain-aware link resolution.

When the screenshot itself shows where the user was shopping (visible_domain),
the resolver verifies candidates from that retailer first, and the
search-results fallback targets the retailer's own search page instead of
generic Naver search. All search URLs are deterministically constructed —
never LLM output.
"""

from dataclasses import dataclass
from urllib.parse import urlencode, urlparse


@dataclass(frozen=True)
class Retailer:
    key: str
    display_name: str
    # A URL belongs to this retailer when its host equals or is a subdomain
    # of one of these.
    domains: tuple[str, ...]
    search_base: str
    search_param: str

    def search_url(self, query: str) -> str:
        return self.search_base + "?" + urlencode({self.search_param: query})


RETAILERS: tuple[Retailer, ...] = (
    Retailer(
        key="coupang",
        display_name="Coupang",
        domains=("coupang.com",),
        search_base="https://www.coupang.com/np/search",
        search_param="q",
    ),
    Retailer(
        key="musinsa",
        display_name="Musinsa",
        domains=("musinsa.com",),
        search_base="https://www.musinsa.com/search/goods",
        search_param="keyword",
    ),
    Retailer(
        key="smartstore",
        display_name="Naver SmartStore",
        domains=("smartstore.naver.com", "brand.naver.com", "shopping.naver.com"),
        # The store slug lives in the URL path, not the domain, so a
        # store-scoped search URL cannot be built from visible_domain alone.
        # Integrated Naver search surfaces smartstore results without the
        # shopping vertical's bot wall.
        search_base="https://search.naver.com/search.naver",
        search_param="query",
    ),
)


def _host(value: str) -> str:
    value = value.strip().lower()
    if "//" in value:
        value = urlparse(value).netloc or value
    return value.split("/")[0]


def _host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def match_retailer(visible_domain: str | None) -> Retailer | None:
    """Map OCR'd domain text from the screenshot to a known retailer."""
    if not visible_domain:
        return None
    host = _host(visible_domain)
    for retailer in RETAILERS:
        if any(_host_matches(host, domain) for domain in retailer.domains):
            return retailer
    return None


def is_retailer_url(retailer: Retailer, url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return any(_host_matches(host, domain) for domain in retailer.domains)
