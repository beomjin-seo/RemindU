from app.pipeline.extraction import CaptureExtraction
from app.schemas import GenericPayload


def resolve_generic(extraction: CaptureExtraction) -> GenericPayload:
    return GenericPayload(ocr_text=extraction.ocr_text or "", summary=extraction.summary)
