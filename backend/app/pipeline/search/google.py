import httpx

from app.pipeline.search.base import ConfigurationError, SearchResult

_CSE_URL = "https://www.googleapis.com/customsearch/v1"
_TIMEOUT = 10.0


class GoogleCSEClient:
    def __init__(self, api_key: str | None, cx: str | None):
        self._api_key = api_key
        self._cx = cx

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        if not self._api_key or not self._cx:
            raise ConfigurationError(
                "Google CSE credentials missing: set GOOGLE_CSE_KEY and GOOGLE_CSE_CX"
            )
        response = httpx.get(
            _CSE_URL,
            params={"key": self._api_key, "cx": self._cx, "q": query, "num": limit},
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
