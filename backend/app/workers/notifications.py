"""Notification worker skeleton.

Run: uv run python -m app.workers.notifications

Invariant 3 (precision >> recall) is encoded in should_notify: two or three
wrong alerts and users disable notifications, which kills the product. When
uncertain, send nothing — never a confident wrong alert.
"""

import logging
import time

from sqlalchemy import select

from app.config import Settings
from app.db import make_engine, make_session_factory
from app.models import Device

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 60 * 60

# Minimum drop before a price alert is even considered. Small fluctuations are
# noise; alerting on them burns user trust for near-zero value.
MIN_PRICE_DROP_RATIO = 0.10


def should_notify(
    *, link_verified: bool, confidence: str, previous_price: int | None, current_price: int | None
) -> bool:
    # Conservative by default: every condition must positively hold.
    # Unknown data -> no notification, not a guess.
    if not link_verified:
        return False
    if confidence != "high":
        return False
    if previous_price is None or current_price is None:
        return False
    if previous_price <= 0:
        return False
    drop_ratio = (previous_price - current_price) / previous_price
    return drop_ratio >= MIN_PRICE_DROP_RATIO


def send_push(apns_token: str, title: str, body: str) -> None:
    # APNs sender stub: logs instead of sending.
    # TODO: real APNs delivery (token-based auth, HTTP/2) once the iOS app ships.
    logger.info("push[stub] token=%s... title=%r body=%r", apns_token[:8], title, body)


def notify_all_devices(session_factory, title: str, body: str) -> int:
    with session_factory() as session:
        devices = session.scalars(select(Device)).all()
    for device in devices:
        send_push(device.apns_token, title, body)
    return len(devices)


def run_once(session_factory) -> None:
    # Skeleton pass: nothing scheduled yet. Deadline alerts and the weekly
    # digest will be driven from card payloads (deadline_at) here.
    logger.info("notifications worker: run_once (no scheduled alerts yet)")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    session_factory = make_session_factory(make_engine(settings.database_url))
    logger.info("notifications worker started (interval=%ss)", POLL_INTERVAL_SECONDS)
    while True:
        run_once(session_factory)
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
