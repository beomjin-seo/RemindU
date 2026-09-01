from typing import Literal

from app.pipeline.extraction import CaptureExtraction

Kind = Literal["shopping", "place", "generic"]
Confidence = Literal["high", "medium", "low"]


def classify(extraction: CaptureExtraction) -> Kind:
    # Conservative routing: a kind without the fields its resolver needs is
    # downgraded to generic rather than resolved into a low-quality card.
    if extraction.kind == "shopping" and not (extraction.product_name or extraction.brand):
        return "generic"
    if extraction.kind == "place" and not extraction.place_name:
        return "generic"
    return extraction.kind


def derive_confidence(extraction: CaptureExtraction) -> Confidence:
    # Invariant 4: HIGH = visible domain + product name; MEDIUM = brand/handle
    # only; LOW = image only (present as similar results, never a definitive match).
    if extraction.visible_domain and extraction.product_name:
        return "high"
    if extraction.brand:
        return "medium"
    return "low"
