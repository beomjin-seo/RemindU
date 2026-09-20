from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.auth import require_install_id
from app.models import Device
from app.schemas import DeviceIn

router = APIRouter(prefix="/v1/devices", tags=["devices"])


@router.post("", status_code=204)
def register_device(
    device: DeviceIn, request: Request, install_id: str = Depends(require_install_id)
) -> Response:
    # Stores the APNs token under the install that owns it; pushes are routed
    # by install_id, so a reinstall (new install id, same token) re-homes the token.
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        existing = session.scalar(select(Device).where(Device.apns_token == device.apns_token))
        if existing is None:
            session.add(Device(apns_token=device.apns_token, install_id=install_id))
        elif existing.install_id != install_id:
            existing.install_id = install_id
        try:
            session.commit()
        except IntegrityError:
            # A concurrent registration inserted the same token between our
            # SELECT and INSERT; the token exists, so this is idempotent
            # success, not an error.
            session.rollback()
    return Response(status_code=204)
