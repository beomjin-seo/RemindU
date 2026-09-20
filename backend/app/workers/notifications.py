"""Notification worker: deadline alerts, weekly digest, resolved pushes.

Run: uv run python -m app.workers.notifications

Invariant 3 (precision >> recall): two or three wrong alerts and users
disable notifications, which kills the product. Every trigger is written to
NotificationLog before delivery so it can never fire twice, unknown data
sends nothing, and a digest with nothing in it is never sent. Pushes go only
to the devices of the install that owns the card; rejected ("not this")
cards never trigger anything.

Schedule (KST):
- deadline: cards whose deadline_at falls within the next 36h AND on today's
  or tomorrow's KST date, pushed once during the 19:30-21:30 window
  ("오늘 마감" / "내일 마감"). A deadline two calendar days out waits for the
  next evening.
- digest: Sunday 19:30-21:30, per install, at most once per 6 days, only if
  that install saved anything this week.
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
    "notify_install_devices",
    "push_once",
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


def log_notification(
    session_factory,
    card_id: str | None,
    kind: PushKind,
    now: datetime,
    install_id: str | None = None,
) -> bool:
    """Reserve the trigger before delivery. False when the (card_id, kind)
    pair is already logged, so a concurrent worker cannot double-send."""
    with session_factory() as session:
        session.add(
            NotificationLog(
                card_id=card_id, install_id=install_id, kind=kind, sent_at=_db_utc(now)
            )
        )
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            return False
    return True


def _install_devices(session_factory, install_id: str | None) -> list[Device]:
    if install_id is None:
        return []  # legacy rows with no owner: nobody to push to
    with session_factory() as session:
        return session.scalars(select(Device).where(Device.install_id == install_id)).all()


def notify_install_devices(
    session_factory, sender: PushSender, payload: dict, install_id: str | None
) -> int:
    """Deliver to every device of one install; drops devices APNs reports as
    unregistered. Returns the number of devices attempted."""
    devices = _install_devices(session_factory, install_id)
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


def push_once(
    session_factory,
    sender: PushSender,
    card_id: str | None,
    kind: PushKind,
    title: str,
    body: str,
    now: datetime,
    install_id: str | None,
) -> bool:
    """One push for one trigger, to the owning install only. False when the
    trigger was already logged or the install has no device to receive it
    (nothing is logged then, so a device registered later still gets it)."""
    if not _install_devices(session_factory, install_id):
        return False
    # Log first, then send: a crash in between loses one push, never duplicates one.
    if not log_notification(session_factory, card_id, kind, now, install_id):
        return False
    payload = build_push_payload(title, body, card_id or "", kind)
    notify_install_devices(session_factory, sender, payload, install_id)
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


def _deadline_title(now: datetime, deadline_at: datetime, name: str) -> str | None:
    # Wording follows the KST calendar, not the 36h horizon: a deadline two
    # days out is not "tomorrow" yet and waits for the next evening's run.
    days = (deadline_at.astimezone(SEOUL).date() - _seoul(now).date()).days
    if days == 0:
        return f"오늘 마감: {name}"
    if days == 1:
        return f"내일 마감: {name}"
    return None


def _deadline_body(payload: dict, deadline_at: datetime) -> str:
    local = deadline_at.astimezone(SEOUL)
    text = payload.get("deadline_text") or f"{local.month}월 {local.day}일 {local:%H:%M}"
    domain = (payload.get("link") or {}).get("domain")
    return f"{text} · {domain}" if domain else text


def run_deadline_alerts(session_factory, sender: PushSender, now: datetime) -> int:
    """Evening alert for shopping cards with an explicit deadline_at in
    (now, now + 36h] that falls today or tomorrow (KST). One per card, ever."""
    now = _aware(now)
    if not in_evening_window(now):
        return 0
    with session_factory() as session:
        logged = select(NotificationLog.card_id).where(NotificationLog.kind == "deadline")
        cards = session.scalars(
            select(Card).where(
                Card.type == "shopping",
                Card.status == "resolved",
                Card.install_id.is_not(None),
                Card.id.not_in(logged),
            )
        ).all()

    sent = 0
    for card in cards:
        deadline_at = deadline_at_of(card.payload)
        if deadline_at is None or not (now < deadline_at <= now + DEADLINE_HORIZON):
            continue
        title = _deadline_title(now, deadline_at, card.payload.get("product_name") or card.title)
        if title is None:
            continue
        body = _deadline_body(card.payload, deadline_at)
        if push_once(session_factory, sender, card.id, "deadline", title, body, now, card.install_id):
            sent += 1
    return sent


def run_weekly_digest(session_factory, sender: PushSender, now: datetime) -> int:
    """Sunday-evening digest of each install's week. Nothing saved -> nothing sent."""
    now = _aware(now)
    if _seoul(now).weekday() != DIGEST_WEEKDAY or not in_evening_window(now):
        return 0
    since = _db_utc(now - DIGEST_LOOKBACK)
    digests: list[tuple[str, int, list[str]]] = []
    with session_factory() as session:
        recent = select(Card).where(
            Card.created_at >= since, Card.status == "resolved", Card.install_id.is_not(None)
        )
        installs = session.scalars(
            select(Card.install_id).where(recent.whereclause).distinct()
        ).all()
        for install_id in installs:
            recent_digest = session.scalar(
                select(NotificationLog.id).where(
                    NotificationLog.kind == "digest",
                    NotificationLog.install_id == install_id,
                    NotificationLog.sent_at >= _db_utc(now - DIGEST_MIN_GAP),
                )
            )
            if recent_digest is not None:
                continue
            own = recent.where(Card.install_id == install_id)
            count = session.scalar(select(func.count()).select_from(own.subquery())) or 0
            if count == 0:
                continue  # never a hollow digest
            titles = session.scalars(
                own.with_only_columns(Card.title)
                .order_by(Card.created_at.desc())
                .limit(DIGEST_MAX_TITLES)
            ).all()
            digests.append((install_id, count, titles))

    sent = 0
    for install_id, count, titles in digests:
        title = f"이번 주 저장 {count}개"
        if push_once(
            session_factory, sender, None, "digest", title, " · ".join(titles), now, install_id
        ):
            sent += 1
    return sent


def _resolved_title(card: Card) -> str:
    # "찾았어요" only when something was actually found: a verified product
    # link or a geocoded place. A search-results fallback or a generic card
    # was merely saved, and the push must not claim otherwise.
    payload = card.payload
    found = (card.type == "shopping" and bool((payload.get("link") or {}).get("verified"))) or (
        card.type == "place" and payload.get("lat") is not None
    )
    return f"{'찾았어요' if found else '저장했어요'}: {card.title}"


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
    return push_once(
        session_factory,
        sender,
        card.id,
        "resolved",
        _resolved_title(card),
        _resolved_body(card),
        datetime.now(timezone.utc),
        card.install_id,
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
