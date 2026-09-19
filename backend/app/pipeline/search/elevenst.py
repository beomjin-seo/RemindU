"""11st OpenAPI ProductSearch client.

Primary Korean commerce search backbone since the Naver Shopping search API
was terminated (2026-07-31). Results are real 11st product pages; like every
other candidate they still go through fetch-and-match verification before
being shown as a product link.
"""

import re
import xml.etree.ElementTree as ET

import httpx

from app.pipeline.search.base import ConfigurationError, SearchResult

_API_URL = "http://openapi.11st.co.kr/openapi/OpenApiService.tmall"
_TIMEOUT = 10.0
_ENCODING_DECL = re.compile(rb"^\s*<\?xml[^>]*encoding=[\"']([A-Za-z0-9._-]+)[\"']")


def _decode(xml_bytes: bytes) -> str:
    # The API answers in EUC-KR (declared in the XML prolog). expat rejects
    # multi-byte encodings named in the declaration, so decode here and hand
    # the parser a str, which makes it ignore the declared encoding.
    match = _ENCODING_DECL.match(xml_bytes)
    encoding = match.group(1).decode("ascii") if match else "utf-8"
    try:
        return xml_bytes.decode(encoding, errors="replace")
    except LookupError:
        return xml_bytes.decode("utf-8", errors="replace")


def _child_text(element: ET.Element, tag: str) -> str:
    child = element.find(tag)
    return (child.text or "").strip() if child is not None else ""


def _parse_price(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", value)
    return int(digits) if digits else None


def parse_product_search(xml_bytes: bytes) -> list[SearchResult]:
    try:
        root = ET.fromstring(_decode(xml_bytes))
    except ET.ParseError:
        return []
    results: list[SearchResult] = []
    for product in root.iter("Product"):
        url = _child_text(product, "DetailPageUrl")
        if not url:
            continue
        results.append(
            SearchResult(
                url=url,
                title=_child_text(product, "ProductName"),
                # Seller name goes in snippet so rank_candidates can match
                # the store_name read from the screenshot.
                snippet=_child_text(product, "SellerNick"),
                price=_parse_price(_child_text(product, "ProductPrice")),
            )
        )
    return results


class ElevenStClient:
    def __init__(self, api_key: str | None):
        self._api_key = api_key

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        if not self._api_key:
            raise ConfigurationError("11st API key missing: set ELEVENST_API_KEY")
        response = httpx.get(
            _API_URL,
            params={
                "key": self._api_key,
                "apiCode": "ProductSearch",
                "keyword": query,
                "pageNum": 1,
                "pageSize": limit,
            },
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        return parse_product_search(response.content)[:limit]
