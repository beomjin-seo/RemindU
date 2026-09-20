"""HeuristicExtractor over real on-device OCR output (tests/fixtures/ocr/*.txt,
produced by Apple Vision from the sample screenshots)."""

from pathlib import Path

import pytest

from app.pipeline.classifier import classify, derive_confidence
from app.pipeline.extraction import ExtractionError
from app.pipeline.heuristic import HeuristicExtractor

FIXTURES = Path(__file__).parent / "fixtures" / "ocr"


def load(name: str) -> str:
    return (FIXTURES / f"{name}.txt").read_text()


def extract(name: str):
    return HeuristicExtractor().extract(b"", "image/jpeg", None, load(name))


@pytest.mark.parametrize(
    "name, domain, title_token, price, brand",
    [
        ("preflow_keyboard_naver", "m.brand.naver.com", "archon", 49900, None),
        ("zardins_pants", "m.zardins.com", "와이드팬츠", 44900, "Zardins"),
        ("jamesperse_tee", "jamesperse.com", "SLUB JERSEY", 212500, "James Perse"),
        ("cloitcase_iphone", "cloitcase.com", "아이폰 실리콘 케이스", 9800, None),
        ("stranger_tee", None, "Relaxed Fit Linen", 62300, "Stranger"),
        ("moodinside_tee", "mood-inside.co.kr", "Ribbed Muscle", None, None),
        ("meditold_bodywash", "m.meditold.com", "퍼시닌 바디워시", None, None),
        ("seiko_ebay", None, "Seiko Alarm Quartz", None, "Seiko"),
        ("onoff_instagram", None, "맥세이프 케이스", None, "onoff.case"),
    ],
)
def test_real_screenshots_structure_as_shopping(name, domain, title_token, price, brand):
    extraction = extract(name)
    assert extraction.kind == "shopping"
    assert classify(extraction) == "shopping"
    assert extraction.visible_domain == domain
    assert title_token in extraction.product_name
    assert extraction.price == price
    if brand is not None:
        assert extraction.brand == brand
    assert extraction.ocr_text


def test_sale_price_wins_over_struck_original():
    # "5% 52,530원" then "49,900원" on the next line: the sale price is the product price.
    assert extract("preflow_keyboard_naver").price == 49900


def test_coupon_amounts_are_not_prices():
    # "카카오톡 채널 추가시 1,000원 추가할인" must not become the product price.
    assert extract("meditold_bodywash").price is None


def test_deadline_prefers_day_count_line():
    assert extract("meditold_bodywash").deadline_text == "딱 7일, 공구 단독 할인!"


def test_noun_list_suffix_is_not_a_deadline():
    # "…투명케이스까지" is a list, not a deadline.
    assert extract("onoff_instagram").deadline_text is None


def test_confidence_tiers_follow_visible_evidence():
    assert derive_confidence(extract("zardins_pants")) == "high"
    assert derive_confidence(extract("onoff_instagram")) == "medium"


def test_too_little_text_fails_closed():
    with pytest.raises(ExtractionError) as info:
        HeuristicExtractor().extract(b"", "image/jpeg", None, "ab c")
    assert info.value.reason == "no_text"


def test_never_emits_urls():
    for path in FIXTURES.glob("*.txt"):
        extraction = HeuristicExtractor().extract(b"", "image/jpeg", None, path.read_text())
        dumped = extraction.model_dump()
        for key, value in dumped.items():
            if key == "ocr_text" or value is None:
                continue
            assert "http" not in str(value).lower(), (path.name, key)
