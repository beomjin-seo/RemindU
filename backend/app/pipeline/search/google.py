import httpx

from app.pipeline.search.base import ConfigurationError, SearchResult
from app.pipeline.trust import TRUSTED_DOMAIN_SUFFIXES

_CSE_URL = "https://www.googleapis.com/customsearch/v1"
_TIMEOUT = 10.0


class GoogleCSEClient:
    def __init__(self, api_key: str | None, cx: str | None, site_restricted: bool = False):
        self._api_key = api_key
        self._cx = cx
        # Restrict results to the trusted retailer/portal allowlist so every
        # candidate is a known commerce domain before verification.
        self._site_restricted = site_restricted

    def build_query(self, query: str) -> str:
        if not self._site_restricted:
            return query
        sites = " OR ".join(f"site:{domain}" for domain in TRUSTED_DOMAIN_SUFFIXES)
        return f"{query} ({sites})"

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        if not self._api_key or not self._cx:
            raise ConfigurationError(
                "Google CSE credentials missing: set GOOGLE_CSE_KEY and GOOGLE_CSE_CX"
            )
        response = httpx.get(
            _CSE_URL,
            params={
                "key": self._api_key,
                "cx": self._cx,
                "q": self.build_query(query),
                "num": min(limit, 10),
            },
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        return [
            SearchResult(
                url=item["link"],
                title=item.get("title", ""),
                snippet=item.get("snippet", ""),
            )
            for item in response.json().get("items", [])
        ]
