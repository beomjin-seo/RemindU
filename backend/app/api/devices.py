from fastapi import APIRouter, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Device
from app.schemas import DeviceIn

router = APIRouter(prefix="/v1/devices", tags=["devices"])


@router.post("", status_code=204)
def register_device(device: DeviceIn, request: Request) -> Response:
    # Registration stub: stores the APNs token for later push delivery.
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        existing = session.scalar(select(Device).where(Device.apns_token == device.apns_token))
        if existing is None:
            session.add(Device(apns_token=device.apns_token))
            try:
                session.commit()
            except IntegrityError:
                # A concurrent registration inserted the same token between our
                # SELECT and INSERT; the token exists, so this is idempotent
                # success, not an error.
                session.rollback()
    return Response(status_code=204)
