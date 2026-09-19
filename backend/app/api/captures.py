import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from app.models import Capture
from app.pipeline.runner import process_capture
from app.schemas import CaptureCreatedOut, CaptureStatusOut

router = APIRouter(prefix="/v1/captures", tags=["captures"])

_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png"}


@router.post("", status_code=201, response_model=CaptureCreatedOut)
async def create_capture(
    request: Request,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    source_hint: str | None = Form(None),
    # Newline-separated lines recognized on-device (Vision framework). This is
    # the default extraction input; the image itself is only analyzed when
    # ALLOW_IMAGE_EXTRACTION is enabled server-side.
    ocr_text: str | None = Form(None),
) -> CaptureCreatedOut:
    settings = request.app.state.settings
    session_factory = request.app.state.session_factory

    # Reject unsupported types up front: accepting them (e.g. HEIC/WebP from
    # iOS shares) would only guarantee a status=failed capture later, because
    # the extractor sends the stored bytes with a jpeg/png media type.
    # TODO: transcode HEIC/WebP to JPEG at upload time instead of rejecting.
    extension = _EXTENSIONS.get(image.content_type or "")
    if extension is None:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported image type {image.content_type!r}; "
            "supported: image/jpeg, image/png",
        )

    capture_id = uuid.uuid4().hex
    image_path = settings.data_dir / f"{capture_id}{extension}"
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(await image.read())

    with session_factory() as session:
        session.add(
            Capture(
                id=capture_id,
                status="processing",
                source_hint=source_hint,
                ocr_text=(ocr_text or "").strip() or None,
                image_path=str(image_path),
            )
        )
        session.commit()

    background_tasks.add_task(process_capture, capture_id, session_factory, request.app.state.deps)
    return CaptureCreatedOut(capture_id=capture_id)


@router.get("/{capture_id}", response_model=CaptureStatusOut)
def get_capture(capture_id: str, request: Request) -> CaptureStatusOut:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        capture = session.get(Capture, capture_id)
        if capture is None:
            raise HTTPException(status_code=404, detail="capture not found")
        return CaptureStatusOut(
            capture_id=capture.id,
            status=capture.status,
            card_id=capture.card_id,
            failure_reason=capture.failure_reason,
        )


@router.get("/{capture_id}/image")
def get_capture_image(capture_id: str, request: Request) -> FileResponse:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        capture = session.get(Capture, capture_id)
        if capture is None:
            raise HTTPException(status_code=404, detail="capture not found")
        image_path = Path(capture.image_path)
    if not image_path.is_file():
        raise HTTPException(status_code=404, detail="capture image missing")
    media_type = "image/jpeg" if image_path.suffix in (".jpg", ".jpeg") else "image/png"
    return FileResponse(image_path, media_type=media_type)
