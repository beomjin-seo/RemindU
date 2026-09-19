import base64

import pytest

from app.pipeline.extraction import (
    AnthropicExtractor,
    CaptureExtraction,
    ExtractionError,
    FakeExtractor,
    RoutingExtractor,
    TextExtractor,
    usable_ocr_text,
)

OCR_TEXT = "www.musinsa.com\nNike Air Max 97\n129,000원"
PIXELS = b"fake-screenshot-pixels"
EXTRACTION = CaptureExtraction(kind="shopping", product_name="Nike Air Max 97")


class _FakeParsedResponse:
    def __init__(self, parsed, stop_reason="end_turn"):
        self.parsed_output = parsed
        self.stop_reason = stop_reason


class _FakeMessages:
    def __init__(self, response):
        self.response = response
        self.calls: list[dict] = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class _FakeAnthropicClient:
    def __init__(self, response):
        self.messages = _FakeMessages(response)


def test_text_extractor_sends_text_only_request():
    # Privacy invariant: the OCR path never puts an image block (or the
    # base64 of the pixels) into the model request.
    client = _FakeAnthropicClient(_FakeParsedResponse(EXTRACTION))
    extractor = TextExtractor(model="test-model", client=client)

    result = extractor.extract(PIXELS, "image/png", source_hint="share-ext", ocr_text=OCR_TEXT)

    assert result is EXTRACTION
    (call,) = client.messages.calls
    assert call["model"] == "test-model"
    assert call["max_tokens"] == 4096
    assert call["output_format"] is CaptureExtraction
    (message,) = call["messages"]
    assert message["role"] == "user"
    blocks = message["content"]
    assert [block["type"] for block in blocks] == ["text"]
    assert OCR_TEXT in blocks[0]["text"]
    assert "share-ext" in blocks[0]["text"]
    assert base64.standard_b64encode(PIXELS).decode() not in repr(call)


def test_text_extractor_rejects_unusable_ocr_text():
    client = _FakeAnthropicClient(_FakeParsedResponse(EXTRACTION))
    with pytest.raises(ExtractionError) as info:
        TextExtractor(model="m", client=client).extract(PIXELS, "image/png", ocr_text="ab  c")
    assert info.value.reason == "no_text"
    assert client.messages.calls == []


def test_text_extractor_refusal_is_extraction_failed():
    client = _FakeAnthropicClient(_FakeParsedResponse(None, stop_reason="refusal"))
    with pytest.raises(ExtractionError) as info:
        TextExtractor(model="m", client=client).extract(PIXELS, "image/png", ocr_text=OCR_TEXT)
    assert info.value.reason == "extraction_failed"


def test_image_extractor_sends_image_block():
    client = _FakeAnthropicClient(_FakeParsedResponse(EXTRACTION))
    AnthropicExtractor(model="m", client=client).extract(PIXELS, "image/png")

    (call,) = client.messages.calls
    blocks = call["messages"][0]["content"]
    assert [block["type"] for block in blocks] == ["image", "text"]
    assert blocks[0]["source"]["media_type"] == "image/png"
    assert blocks[0]["source"]["data"] == base64.standard_b64encode(PIXELS).decode()


@pytest.mark.parametrize(
    "text,expected",
    [
        (None, False),
        ("", False),
        ("  \n ", False),
        ("abc defg", False),  # 7 non-space chars
        ("abcd efgh", True),  # 8 non-space chars
        ("가나다라\n마바사아", True),
    ],
)
def test_usable_ocr_text(text, expected):
    assert usable_ocr_text(text) is expected


def test_routing_prefers_text_extractor_even_when_image_allowed():
    text = FakeExtractor(EXTRACTION)
    image = FakeExtractor(EXTRACTION)
    RoutingExtractor(text, image, allow_image=True).extract(PIXELS, "image/png", ocr_text=OCR_TEXT)
    assert len(text.calls) == 1
    assert image.calls == []


def test_routing_fails_no_text_when_image_not_allowed():
    text = FakeExtractor(EXTRACTION)
    image = FakeExtractor(EXTRACTION)
    with pytest.raises(ExtractionError) as info:
        RoutingExtractor(text, image, allow_image=False).extract(PIXELS, "image/png")
    assert info.value.reason == "no_text"
    assert text.calls == [] and image.calls == []


def test_routing_falls_back_to_image_when_allowed():
    text = FakeExtractor(EXTRACTION)
    image = FakeExtractor(EXTRACTION)
    RoutingExtractor(text, image, allow_image=True).extract(PIXELS, "image/png", ocr_text="")
    assert text.calls == []
    assert len(image.calls) == 1
