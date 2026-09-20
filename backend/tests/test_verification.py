from app.pipeline.extraction import CaptureExtraction
from app.pipeline.verification import is_safe_candidate_url, price_matches, verify_candidate

AIRMAX = CaptureExtraction(kind="shopping", product_name="Nike Air Max 97", price=129000)
URL = "https://www.musinsa.com/p/airmax97"


def page(text: str):
    return lambda url: text


def test_name_plus_price_in_context_verifies():
    assert verify_candidate(page("<h1>Nike Air Max 97</h1><span>129,000원</span>"), URL, AIRMAX)
    assert verify_candidate(
        page('<h1>Nike Air Max 97</h1><meta property="product:price:amount" content="129000">'),
        URL,
        AIRMAX,
    )
    assert verify_candidate(
        page('Nike Air Max 97 {"price": "129000", "priceCurrency": "KRW"}'), URL, AIRMAX
    )


def test_similar_model_number_does_not_verify():
    # 3 of 4 name tokens overlap, but the model number differs.
    assert not verify_candidate(page("Nike Air Max 90 129,000원"), URL, AIRMAX)


def test_price_digits_alone_never_verify():
    assert not verify_candidate(page("order #129000 shipped"), URL, AIRMAX)
    assert not verify_candidate(page("Nike Air Max 97 order #129000"), URL, AIRMAX)
    nameless = AIRMAX.model_copy(update={"product_name": None})
    assert not verify_candidate(page("129,000원"), URL, nameless)


def test_search_api_price_counts_as_the_price_match():
    text = "Nike Air Max 97 - sneakers"
    assert not verify_candidate(page(text), URL, AIRMAX)
    assert verify_candidate(page(text), URL, AIRMAX, result_price=129000)
    assert not verify_candidate(page(text), URL, AIRMAX, result_price=119000)


def test_name_alone_verifies_when_no_price_was_read():
    no_price = AIRMAX.model_copy(update={"price": None})
    assert verify_candidate(page("Nike Air Max 97"), URL, no_price)
    assert not verify_candidate(page("Nike Air Force 1"), URL, no_price)


def test_off_allowlist_domain_is_never_fetched():
    calls: list[str] = []

    def fetch(url: str) -> str:
        calls.append(url)
        return "Nike Air Max 97 129,000원"

    assert not verify_candidate(fetch, "https://store.example.com/p/1", AIRMAX)
    assert calls == []
    assert not is_safe_candidate_url("ftp://www.musinsa.com/p/1")
    assert is_safe_candidate_url("https://m.coupang.com/vp/1")


def test_fetch_failure_is_unverified():
    def boom(url: str) -> str:
        raise RuntimeError("timeout")

    assert not verify_candidate(boom, URL, AIRMAX)


def test_price_context_variants():
    assert price_matches("₩129,000", 129000)
    assert price_matches("KRW 129000", 129000)
    assert price_matches("129,000 won", 129000)
    assert price_matches("<b>129,000</b><em>원</em>", 129000)
    assert not price_matches("1,129,000원", 129000)
    assert not price_matches("129,0001원", 129000)
    assert not price_matches("SKU 129000", 129000)
