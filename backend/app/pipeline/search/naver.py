import re

import httpx

from app.pipeline.search.base import ConfigurationError, PlaceResult, SearchResult

_SHOP_URL = "https://openapi.naver.com/v1/search/shop.json"
_LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
_TIMEOUT = 10.0


def _strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text)


class _NaverClientBase:
    def __init__(self, client_id: str | None, client_secret: str | None):
        self._client_id = client_id
        self._client_secret = client_secret

    def _headers(self) -> dict[str, str]:
        # Env-gated: constructing without keys is allowed so the app can boot;
        # actually searching without keys is a configuration error.
        if not self._client_id or not self._client_secret:
            raise ConfigurationError(
                "Naver API credentials missing: set NAVER_CLIENT_ID and NAVER_CLIENT_SECRET"
            )
        return {
            "X-Naver-Client-Id": self._client_id,
            "X-Naver-Client-Secret": self._client_secret,
        }


class NaverShoppingClient(_NaverClientBase):
    """DEPRECATED: the Naver Shopping search API (/v1/search/shop.json) was
    permanently terminated on 2026-07-31. Kept for reference only and no longer
    part of the default wiring; use ElevenStClient + GoogleCSEClient via
    CompositeSearchClient instead. NaverLocalClient is unaffected (legacy keys
    remain valid until 2027-06-30)."""

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        headers = self._headers()
        response = httpx.get(
            _SHOP_URL,
            params={"query": query, "display": limit},
            headers=headers,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        results = []
        for item in response.json().get("items", []):
            price = None
            if item.get("lprice"):
                try:
                    price = int(item["lprice"])
                except ValueError:
                    price = None
            results.append(
                SearchResult(
                    url=item["link"],
                    title=_strip_tags(item.get("title", "")),
                    snippet=item.get("mallName", ""),
                    price=price,
                )
            )
        return results


class NaverLocalClient(_NaverClientBase):
    def search_places(self, query: str, limit: int = 5) -> list[PlaceResult]:
        headers = self._headers()
        response = httpx.get(
            _LOCAL_URL,
            params={"query": query, "display": min(limit, 5)},
            headers=headers,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        results = []
        for item in response.json().get("items", []):
            # mapx/mapy are WGS84 coordinates scaled by 1e7 in the Local API.
            lat = lng = None
            try:
                lng = int(item["mapx"]) / 1e7
                lat = int(item["mapy"]) / 1e7
            except (KeyError, ValueError):
                pass
            results.append(
                PlaceResult(
                    name=_strip_tags(item.get("title", "")),
                    url=item.get("link") or None,
                    category=item.get("category") or None,
                    address=item.get("roadAddress") or item.get("address") or None,
                    lat=lat,
                    lng=lng,
                )
            )
        return results
