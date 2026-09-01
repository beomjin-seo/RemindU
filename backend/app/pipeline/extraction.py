import base64
from typing import Literal, Protocol

from pydantic import BaseModel


class ExtractionError(RuntimeError):
    pass


class CaptureExtraction(BaseModel):
    # INVARIANT: this schema must never contain a URL field. The LLM never
    # generates URLs; candidate links come exclusively from search APIs.
    # visible_domain is plain text read via OCR from the screenshot, not a link.
    kind: Literal["shopping", "place", "generic"]
    visible_domain: str | None = None
    product_name: str | None = None
    brand: str | None = None
    price: int | None = None
    currency: str | None = None
    deadline_text: str | None = None
    place_name: str | None = None
    area_hint: str | None = None
    category: str | None = None
    ocr_text: str | None = None
    summary: str | None = None


class Extractor(Protocol):
    def extract(
        self, image_bytes: bytes, media_type: str, source_hint: str | None = None
    ) -> CaptureExtraction: ...


_INSTRUCTION = (
    "Analyze this screenshot and extract structured capture data. "
    "Classify it as shopping (a product, price, or sale), place (a restaurant, "
    "cafe, or location), or generic (anything else). Fill only fields you can "
    "read from the image. visible_domain is the domain text visible in the "
    "screenshot, if any. Never guess values that are not visible."
)


class AnthropicExtractor:
    def __init__(self, model: str, api_key: str | None = None):
        self._model = model
        self._api_key = api_key
        self._client = None

    def _get_client(self):
        if self._client is None:
            import anthropic

            if self._api_key:
                self._client = anthropic.Anthropic(api_key=self._api_key)
            else:
                self._client = anthropic.Anthropic()
        return self._client

    def extract(
        self, image_bytes: bytes, media_type: str, source_hint: str | None = None
    ) -> CaptureExtraction:
        client = self._get_client()
        instruction = _INSTRUCTION
        if source_hint:
            instruction += f"\nSource hint from the client app: {source_hint}"
        response = client.messages.parse(
            model=self._model,
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64.standard_b64encode(image_bytes).decode(),
                            },
                        },
                        {"type": "text", "text": instruction},
                    ],
                }
            ],
            output_format=CaptureExtraction,
        )
        if response.stop_reason == "refusal":
            raise ExtractionError("extraction refused by model safety classifiers")
        parsed = response.parsed_output
        if parsed is None:
            raise ExtractionError("model returned no parseable extraction")
        return parsed


class FakeExtractor:
    def __init__(self, extraction: CaptureExtraction):
        self.extraction = extraction
        self.calls: list[dict] = []

    def extract(
        self, image_bytes: bytes, media_type: str, source_hint: str | None = None
    ) -> CaptureExtraction:
        self.calls.append(
            {"num_bytes": len(image_bytes), "media_type": media_type, "source_hint": source_hint}
        )
        return self.extraction
