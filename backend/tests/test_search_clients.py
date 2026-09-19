import json

import pytest

from app.pipeline.search import elevenst, google
from app.pipeline.search.base import ConfigurationError, SearchResult
from app.pipeline.search.composite import CompositeSearchClient
from app.pipeline.search.elevenst import ElevenStClient, parse_product_search
from app.pipeline.search.fake import FakeSearchClient
from app.pipeline.search.google import GoogleCSEClient
from app.pipeline.trust import TRUSTED_DOMAIN_SUFFIXES

ELEVENST_XML = """<?xml version="1.0" encoding="UTF-8"?>
<ProductSearchResponse>
  <Request>
    <Arguments>
      <Argument><Name>keyword</Name><Value>Nike Air Max 97</Value></Argument>
    </Arguments>
  </Request>
  <TotalCount>3</TotalCount>
  <Products>
    <Product>
      <ProductCode>111</ProductCode>
      <ProductName><![CDATA[나이키 에어맥스 97]]></ProductName>
      <ProductPrice>129,000</ProductPrice>
      <DetailPageUrl>http://www.11st.co.kr/products/111</DetailPageUrl>
      <SellerNick>나이키공식스토어</SellerNick>
    </Product>
    <Product>
      <ProductCode>222</ProductCode>
      <ProductName>Nike Air Max 97 OG</ProductName>
      <DetailPageUrl>http://www.11st.co.kr/products/222</DetailPageUrl>
    </Product>
    <Product>
      <ProductCode>333</ProductCode>
      <ProductName>No detail URL: must be skipped</ProductName>
    </Product>
  </Products>
</ProductSearchResponse>
"""


class _FakeResponse:
    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self) -> None:
        pass

    def json(self):
        return json.loads(self.content)


def test_elevenst_parses_product_search_xml(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params))
        return _FakeResponse(ELEVENST_XML.encode("utf-8"))

    monkeypatch.setattr(elevenst.httpx, "get", fake_get)

    results = ElevenStClient("key123").search("Nike Air Max 97", limit=5)

    assert calls[0][0] == "http://openapi.11st.co.kr/openapi/OpenApiService.tmall"
    assert calls[0][1] == {
        "key": "key123",
        "apiCode": "ProductSearch",
        "keyword": "Nike Air Max 97",
        "pageNum": 1,
        "pageSize": 5,
    }
    assert results == [
        SearchResult(
            url="http://www.11st.co.kr/products/111",
            title="나이키 에어맥스 97",
            snippet="나이키공식스토어",
            price=129000,
        ),
        SearchResult(url="http://www.11st.co.kr/products/222", title="Nike Air Max 97 OG"),
    ]


def test_elevenst_limit_truncates_results(monkeypatch):
    monkeypatch.setattr(
        elevenst.httpx, "get", lambda *a, **k: _FakeResponse(ELEVENST_XML.encode("utf-8"))
    )
    assert len(ElevenStClient("key").search("q", limit=1)) == 1


def test_elevenst_honors_declared_euc_kr_encoding():
    xml_bytes = ELEVENST_XML.replace('encoding="UTF-8"', 'encoding="EUC-KR"').encode("euc-kr")
    results = parse_product_search(xml_bytes)
    assert results[0].title == "나이키 에어맥스 97"
    assert results[0].snippet == "나이키공식스토어"


def test_elevenst_malformed_xml_returns_empty():
    assert parse_product_search(b"<not xml at all") == []


def test_elevenst_without_key_raises_configuration_error(monkeypatch):
    def no_http(*args, **kwargs):
        raise AssertionError("no HTTP call expected without a key")

    monkeypatch.setattr(elevenst.httpx, "get", no_http)
    with pytest.raises(ConfigurationError):
        ElevenStClient(None).search("anything")


def test_google_site_restricted_query(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(params)
        items = [{"link": "https://www.coupang.com/vp/1", "title": "t", "snippet": "s"}]
        return _FakeResponse(json.dumps({"items": items}).encode())

    monkeypatch.setattr(google.httpx, "get", fake_get)

    results = GoogleCSEClient("k", "cx", site_restricted=True).search("Nike Air Max 97", limit=3)

    query = calls[0]["q"]
    assert query.startswith("Nike Air Max 97 (site:naver.com OR site:")
    assert query.endswith(")")
    assert all(f"site:{domain}" in query for domain in TRUSTED_DOMAIN_SUFFIXES)
    assert calls[0]["num"] == 3
    assert results == [SearchResult(url="https://www.coupang.com/vp/1", title="t", snippet="s")]


def test_google_unrestricted_query_is_passed_through():
    assert GoogleCSEClient("k", "cx").build_query("Nike Air Max 97") == "Nike Air Max 97"


def test_google_without_credentials_raises_configuration_error():
    with pytest.raises(ConfigurationError):
        GoogleCSEClient(None, None).search("anything")


class _RaisingClient:
    def __init__(self, exc: Exception):
        self._exc = exc

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        raise self._exc


def test_composite_skips_unconfigured_client_and_returns_the_rest():
    second = FakeSearchClient(
        results=[
            SearchResult(url="https://a.example/1", title="a"),
            SearchResult(url="https://b.example/2", title="b"),
        ]
    )
    composite = CompositeSearchClient([_RaisingClient(ConfigurationError("no key")), second])

    results = composite.search("q", limit=5)

    assert [r.url for r in results] == ["https://a.example/1", "https://b.example/2"]
    assert second.queries == ["q"]


def test_composite_dedupes_by_url_and_tolerates_client_failures():
    first = FakeSearchClient(results=[SearchResult(url="https://a.example/1", title="first")])
    second = FakeSearchClient(
        results=[
            SearchResult(url="https://a.example/1", title="duplicate"),
            SearchResult(url="https://c.example/3", title="c"),
        ]
    )
    composite = CompositeSearchClient([first, _RaisingClient(RuntimeError("boom")), second])

    results = composite.search("q", limit=5)

    assert [r.url for r in results] == ["https://a.example/1", "https://c.example/3"]
    assert results[0].title == "first"  # first client wins on duplicates


def test_composite_caps_total_at_limit_times_clients():
    first = FakeSearchClient(
        results=[SearchResult(url=f"https://a.example/{i}", title="a") for i in range(3)]
    )
    second = FakeSearchClient(
        results=[SearchResult(url=f"https://b.example/{i}", title="b") for i in range(3)]
    )
    assert len(CompositeSearchClient([first, second]).search("q", limit=2)) == 4
