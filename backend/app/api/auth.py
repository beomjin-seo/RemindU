from fastapi import Header, HTTPException

INSTALL_ID_HEADER = "X-Install-Id"
_MAX_INSTALL_ID_LEN = 64


def require_install_id(x_install_id: str | None = Header(None)) -> str:
    # Per-install bearer: a UUID the app generates once and shares with its
    # extension via the App Group. Every capture, card, and device row is
    # scoped to it, so one install can never read or be pushed another's data.
    value = (x_install_id or "").strip()
    if not value or len(value) > _MAX_INSTALL_ID_LEN:
        raise HTTPException(status_code=401, detail=f"missing {INSTALL_ID_HEADER} header")
    return value
