"""Notification worker: deadline alerts, weekly digest, resolved pushes.

Run: uv run python -m app.workers.notifications

Invariant 3 (precision >> recall): two or three wrong alerts and users
disable notifications, which kills the product. Every trigger is written to
NotificationLog before delivery so it can never fire twice, unknown data
sends nothing, and a digest with nothing in it is never sent.

Schedule (KST):
- deadline: cards whose deadline_at falls within the next 36h, pushed once
  during the 19:30-21:30 window the evening before (the "D-1 20:00" slot).
- digest: Sunday 19:30-21:30, at most once per 6 days, only if the week
  saved anything.
- resolved: immediately after a capture becomes a card (settings.push_on_resolved).
- price: see workers/price_tracker.py.
"""

import logging
import time as _time
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db import create_tables, make_engine, make_session_factory
from app.models import Card, Device, NotificationLog
from app.workers.apns import ApnsSender, PushKind, PushSender, build_push_payload

__all__ = [
    "MIN_PRICE_DROP_RATIO",
    "PushKind",
    "PushSender",
    "build_push_payload",
    "already_logged",
    "log_notification",
    "notify_all_devices",
    "run_deadline_alerts",
    "run_weekly_digest",
    "send_resolved_push",
    "run_once",
    "should_notify",
]

logger = logging.getLogger(__name__)

SEOUL = ZoneInfo("Asia/Seoul")
POLL_INTERVAL_SECONDS = 30 * 60  # the evening window is 2h wide; never miss it

EVENING_WINDOW_START = time(19, 30)
EVENING_WINDOW_END = time(21, 30)
DEADLINE_HORIZON = timedelta(hours=36)
DIGEST_WEEKDAY = 6  # Sunday
DIGEST_MIN_GAP = timedelta(days=6)
DIGEST_LOOKBACK = timedelta(days=7)
DIGEST_MAX_TITLES = 3

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


def _aware(now: datetime) -> datetime:
    return now if now.tzinfo else now.replace(tzinfo=timezone.utc)


def _seoul(now: datetime) -> datetime:
    return _aware(now).astimezone(SEOUL)


def _db_utc(now: datetime) -> datetime:
    # DB datetimes are naive UTC (SQLite drops the timezone).
    return now.astimezone(timezone.utc).replace(tzinfo=None)


def in_evening_window(now: datetime) -> bool:
    local = _seoul(now).time()
    return EVENING_WINDOW_START <= local <= EVENING_WINDOW_END


def already_logged(session_factory, card_id: str, kind: PushKind) -> bool:
    with session_factory() as session:
        return (
            session.scalar(
                select(NotificationLog.id).where(
                    NotificationLog.card_id == card_id, NotificationLog.kind == kind
                )
            )
            is not None
        )


def log_notification(session_factory, card_id: str | None, kind: PushKind, now: datetime) -> bool:
    """Reserve the trigger before delivery. False when the (card_id, kind)
    pair is already logged, so a concurrent worker cannot double-send."""
    with session_factory() as session:
        session.add(NotificationLog(card_id=card_id, kind=kind, sent_at=_db_utc(now)))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            return False
    return True


def notify_all_devices(session_factory, sender: PushSender, payload: dict) -> int:
    """Deliver to every registered device; drops devices APNs reports as
    unregistered. Returns the number of devices attempted."""
    # TODO: per-user device targeting once the API has accounts; until then
    # every registered device belongs to the single dev/test user.
    with session_factory() as session:
        devices = session.scalars(select(Device)).all()
    stale: list[str] = []
    for device in devices:
        try:
            result = sender.send(device.apns_token, payload)
        except Exception:
            logger.exception("push delivery failed token=%s...", device.apns_token[:8])
            continue
        if result == "unregistered":
            stale.append(device.id)
    if stale:
        with session_factory() as session:
            session.execute(delete(Device).where(Device.id.in_(stale)))
            session.commit()
        logger.info("removed %d unregistered device(s)", len(stale))
    return len(devices)


def _device_count(session_factory) -> int:
    with session_factory() as session:
        return session.scalar(select(func.count()).select_from(Device)) or 0


def _push(
    session_factory,
    sender: PushSender,
    card_id: str | None,
    kind: PushKind,
    title: str,
    body: str,
    now: datetime,
) -> bool:
    # Log first, then send: a crash in between loses one push, never duplicates one.
    if not log_notification(session_factory, card_id, kind, now):
        return False
    payload = build_push_payload(title, body, card_id or "", kind)
    notify_all_devices(session_factory, sender, payload)
    return True


def deadline_at_of(payload: dict) -> datetime | None:
    raw = payload.get("deadline_at")
    if not raw:
        return None
    try:
        value = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    return value if value.tzinfo else value.replace(tzinfo=SEOUL)


def _deadline_body(payload: dict, deadline_at: datetime) -> str:
    local = deadline_at.astimezone(SEOUL)
    text = payload.get("deadline_text") or f"{local.month}월 {local.day}일 {local:%H:%M}"
    domain = (payload.get("link") or {}).get("domain")
    return f"{text} · {domain}" if domain else text


def run_deadline_alerts(session_factory, sender: PushSender, now: datetime) -> int:
    """D-1 evening alert for shopping cards with an explicit deadline_at in
    (now, now + 36h]. One per card, ever."""
    now = _aware(now)
    if not in_evening_window(now):
        return 0
    with session_factory() as session:
        logged = select(NotificationLog.card_id).where(NotificationLog.kind == "deadline")
        cards = session.scalars(
            select(Card).where(
                Card.type == "shopping", Card.status == "resolved", Card.id.not_in(logged)
            )
        ).all()

    sent = 0
    for card in cards:
        deadline_at = deadline_at_of(card.payload)
        if deadline_at is None or not (now < deadline_at <= now + DEADLINE_HORIZON):
            continue
        title = f"내일 마감: {card.payload.get('product_name') or card.title}"
        body = _deadline_body(card.payload, deadline_at)
        if _push(session_factory, sender, card.id, "deadline", title, body, now):
            sent += 1
    return sent


def run_weekly_digest(session_factory, sender: PushSender, now: datetime) -> int:
    """Sunday-evening digest of the week's saves. Nothing saved -> nothing sent."""
    now = _aware(now)
    if _seoul(now).weekday() != DIGEST_WEEKDAY or not in_evening_window(now):
        return 0
    with session_factory() as session:
        recent_digest = session.scalar(
            select(NotificationLog.id).where(
                NotificationLog.kind == "digest",
                NotificationLog.sent_at >= _db_utc(now - DIGEST_MIN_GAP),
            )
        )
        if recent_digest is not None:
            return 0
        since = _db_utc(now - DIGEST_LOOKBACK)
        recent = select(Card).where(Card.created_at >= since)
        count = session.scalar(select(func.count()).select_from(recent.subquery())) or 0
        if count == 0:
            return 0  # never a hollow digest
        titles = session.scalars(
            select(Card.title)
            .where(Card.created_at >= since)
            .order_by(Card.created_at.desc())
            .limit(DIGEST_MAX_TITLES)
        ).all()
    title = f"이번 주 저장 {count}개"
    return int(_push(session_factory, sender, None, "digest", title, " · ".join(titles), now))


def _resolved_body(card: Card) -> str:
    payload = card.payload
    if card.type == "shopping":
        price, currency = payload.get("price"), payload.get("currency") or "KRW"
        domain = (payload.get("link") or {}).get("domain") or ""
        if price is not None:
            amount = f"{price:,}원" if currency == "KRW" else f"{price:,} {currency}"
            return f"{amount} · {domain}" if domain else amount
        return domain or "카드가 준비됐어요"
    if card.type == "place":
        return payload.get("address") or payload.get("category") or "지도에 저장됨"
    return payload.get("summary") or "저장됨"


def send_resolved_push(session_factory, sender: PushSender, card: Card) -> bool:
    """Called by the pipeline runner right after a card is committed."""
    return _push(
        session_factory,
        sender,
        card.id,
        "resolved",
        f"찾았어요: {card.title}",
        _resolved_body(card),
        datetime.now(timezone.utc),
    )


def run_once(session_factory, sender: PushSender, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if _device_count(session_factory) == 0:
        logger.info("notifications: no registered devices, nothing to send")
        return
    deadlines = run_deadline_alerts(session_factory, sender, now)
    digests = run_weekly_digest(session_factory, sender, now)
    logger.info("notifications: deadline=%d digest=%d", deadlines, digests)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    engine = make_engine(settings.database_url)
    create_tables(engine)
    session_factory = make_session_factory(engine)
    sender = ApnsSender.from_settings(settings)
    logger.info(
        "notifications worker started (interval=%ss, apns=%s)",
        POLL_INTERVAL_SECONDS,
        "configured" if sender.configured else "unconfigured",
    )
    while True:
        run_once(session_factory, sender)
        _time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
