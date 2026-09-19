"""Price tracking worker skeleton.

Run: uv run python -m app.workers.price_tracker

Polls verified product links from shopping cards, parses current prices, and
fires a push only when the conservative gate in notifications.should_notify
passes (invariant 3: precision >> recall — when uncertain, send nothing).
One price alert per card, ever: the trigger is written to NotificationLog
(kind "price") before delivery.

Coverage order (per CLAUDE.md):
TODO: 11st ProductSearch (open API, price + detail URL) first.
TODO: Naver SmartStore page parsing second.
TODO: Coupang — Partners API is gated behind cumulative attributed sales and
      rate-limited far below polling needs; no plan until that is cleared.
TODO: independent malls via custom scraping later (option-level prices, page
      structure changes, and bot blocking are the known hard parts).
"""

import logging
import time
from datetime import datetime, timezone

from sqlalchemy import select

from app.config import Settings
from app.db import create_tables, make_engine, make_session_factory
from app.models import Card, NotificationLog
from app.workers.apns import ApnsSender, PushSender, build_push_payload
from app.workers.notifications import log_notification, notify_all_devices, should_notify

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 6 * 60 * 60


def parse_price(html: str) -> int | None:
    # Stub: returning None means "no confident price" and downstream logic
    # must treat it as unknown, never as zero or unchanged.
    # TODO: per-site parsers (11st -> SmartStore -> scraping).
    return None


def tracked_shopping_cards(session_factory) -> list[Card]:
    with session_factory() as session:
        alerted = select(NotificationLog.card_id).where(NotificationLog.kind == "price")
        cards = session.scalars(
            select(Card).where(Card.type == "shopping", Card.id.not_in(alerted))
        ).all()
    # Only verified product links are trackable; search_results fallbacks are not.
    return [card for card in cards if (card.payload.get("link") or {}).get("verified")]


def run_once(session_factory, sender: PushSender, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    cards = tracked_shopping_cards(session_factory)
    logger.info("price tracker: %d verified product links to check", len(cards))
    sent = 0
    for card in cards:
        payload = card.payload
        link = payload["link"]
        # TODO: fetch link["url"] and parse the current price.
        current_price = parse_price("")
        if current_price is None:
            continue  # unknown price -> no alert, by design
        if not should_notify(
            link_verified=link.get("verified", False),
            confidence=payload.get("confidence", "low"),
            previous_price=payload.get("price"),
            current_price=current_price,
        ):
            continue
        # Log first, then send: the same card never gets a second price alert.
        if not log_notification(session_factory, card.id, "price", now):
            continue
        currency = payload.get("currency") or "KRW"
        amount = f"{current_price:,}원" if currency == "KRW" else f"{current_price:,} {currency}"
        notify_all_devices(
            session_factory,
            sender,
            build_push_payload(
                title=f"가격 인하: {payload.get('product_name', '')}",
                body=f"지금 {amount} · {link.get('domain', '')}",
                card_id=card.id,
                kind="price",
            ),
        )
        sent += 1
    return sent


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    engine = make_engine(settings.database_url)
    create_tables(engine)
    session_factory = make_session_factory(engine)
    sender = ApnsSender.from_settings(settings)
    logger.info("price tracker started (interval=%ss)", POLL_INTERVAL_SECONDS)
    while True:
        run_once(session_factory, sender)
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
