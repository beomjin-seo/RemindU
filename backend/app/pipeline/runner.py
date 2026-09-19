import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from app.models import Capture, Card
from app.pipeline.classifier import classify
from app.pipeline.extraction import CaptureExtraction, ExtractionError, Extractor
from app.pipeline.resolvers.generic import resolve_generic
from app.pipeline.resolvers.place import resolve_place
from app.pipeline.resolvers.shopping import resolve_shopping
from app.pipeline.search.base import LocalSearchClient, SearchClient
from app.pipeline.verification import FetchFn
from app.workers.apns import PushSender
from app.workers.notifications import send_resolved_push

logger = logging.getLogger(__name__)


@dataclass
class PipelineDeps:
    extractor: Extractor
    search_client: SearchClient
    local_client: LocalSearchClient
    fetch_fn: FetchFn
    push_sender: PushSender | None = None
    # "찾았어요" push right after a card resolves (settings.push_on_resolved).
    push_on_resolved: bool = True


def _media_type(image_path: str) -> str:
    return "image/jpeg" if image_path.endswith((".jpg", ".jpeg")) else "image/png"


def _derive_title(kind: str, extraction: CaptureExtraction) -> str:
    if kind == "shopping":
        return extraction.product_name or extraction.brand or "Shopping capture"
    if kind == "place":
        return extraction.place_name or "Place capture"
    first_line = (extraction.ocr_text or "").strip().splitlines()
    return first_line[0][:80] if first_line else "Capture"


def _extract(deps: PipelineDeps, capture: Capture) -> CaptureExtraction:
    image_bytes = Path(capture.image_path).read_bytes()
    try:
        return deps.extractor.extract(
            image_bytes, _media_type(capture.image_path), capture.source_hint, capture.ocr_text
        )
    except ExtractionError:
        raise
    except Exception as exc:
        # SDK/network errors inside the extractor are still extraction failures.
        raise ExtractionError("extraction_failed", str(exc)) from exc


def _failure_reason(exc: Exception) -> str:
    return exc.reason if isinstance(exc, ExtractionError) else "pipeline_failed"


def process_capture(
    capture_id: str, session_factory: sessionmaker[Session], deps: PipelineDeps
) -> None:
    resolved: Card | None = None
    with session_factory() as session:
        capture = session.get(Capture, capture_id)
        if capture is None:
            return
        try:
            extraction = _extract(deps, capture)
            kind = classify(extraction)
            if kind == "shopping":
                payload = resolve_shopping(extraction, deps.search_client, deps.fetch_fn)
            elif kind == "place":
                payload = resolve_place(extraction, deps.local_client)
            else:
                payload = resolve_generic(extraction)

            card = Card(
                capture_id=capture.id,
                type=kind,
                status="resolved",
                title=_derive_title(kind, extraction),
                payload=payload.model_dump(mode="json"),
            )
            session.add(card)
            session.flush()
            capture.card_id = card.id
            capture.status = "resolved"
            capture.failure_reason = None
            session.commit()
            resolved = card
        except Exception as exc:
            # Any pipeline failure marks the capture failed — never a
            # fake-confident card (precision >> recall).
            logger.exception("pipeline failed for capture %s", capture_id)
            session.rollback()
            capture = session.get(Capture, capture_id)
            if capture is not None:
                capture.status = "failed"
                capture.failure_reason = _failure_reason(exc)
                session.commit()

    # After the commit: the card exists whether or not the push goes out.
    if resolved is not None and deps.push_sender is not None and deps.push_on_resolved:
        try:
            send_resolved_push(session_factory, deps.push_sender, resolved)
        except Exception:
            logger.exception("resolved push failed for card %s", resolved.id)
