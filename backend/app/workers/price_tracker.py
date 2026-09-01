"""Price tracking worker skeleton.

Run: uv run python -m app.workers.price_tracker

Polls verified product links from shopping cards, parses current prices, and
fires a push only when the conservative gate in notifications.should_notify
passes (invariant 3: precision >> recall — when uncertain, send nothing).

Coverage order (per CLAUDE.md):
TODO: Naver SmartStore official API parser first.
TODO: Coupang Partners API second.
TODO: independent malls via custom scraping later (option-level prices, page
      structure changes, and bot blocking are the known hard parts).
"""

import logging
import time

from sqlalchemy import select

from app.config import Settings
from app.db import make_engine, make_session_factory
from app.models import Card
from app.workers.notifications import send_push, should_notify

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 6 * 60 * 60


def parse_price(html: str) -> int | None:
    # Stub: returning None means "no confident price" and downstream logic
    # must treat it as unknown, never as zero or unchanged.
    # TODO: per-site parsers (SmartStore API -> Coupang Partners -> scraping).
    return None


def tracked_shopping_cards(session_factory) -> list[Card]:
    with session_factory() as session:
        cards = session.scalars(select(Card).where(Card.type == "shopping")).all()
    # Only verified product links are trackable; search_results fallbacks are not.
    return [card for card in cards if (card.payload.get("link") or {}).get("verified")]


def _record_notified_price(session_factory, card_id: str, price: int) -> None:
    # Persist the price we alerted on so the same drop never re-fires on the
    # next poll cycle (precision >> recall: one drop, one alert).
    with session_factory() as session:
        card = session.get(Card, card_id)
        if card is None:
            return
        # Reassign (not mutate) so SQLAlchemy detects the JSON column change.
        card.payload = {**card.payload, "last_notified_price": price}
        session.commit()


def run_once(session_factory) -> None:
    cards = tracked_shopping_cards(session_factory)
    logger.info("price tracker: %d verified product links to check", len(cards))
    for card in cards:
        payload = card.payload
        link = payload["link"]
        # TODO: fetch link["url"] and parse the current price.
        current_price = parse_price("")
        if current_price is None:
            continue  # unknown price -> no alert, by design
        # Baseline for the drop check: the last price we already alerted on,
        # falling back to the screenshot-extracted price for the first alert.
        # Without this, the same >=10% drop would re-fire every poll cycle.
        previous_price = payload.get("last_notified_price") or payload.get("price")
        if should_notify(
            link_verified=link.get("verified", False),
            confidence=payload.get("confidence", "low"),
            previous_price=previous_price,
            current_price=current_price,
        ):
            send_push(
                apns_token="<device-lookup-todo>",
                title=f"Price drop: {payload.get('product_name', '')}",
                body=f"Now {current_price:,} {payload.get('currency', 'KRW')}",
            )
            _record_notified_price(session_factory, card.id, current_price)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    session_factory = make_session_factory(make_engine(settings.database_url))
    logger.info("price tracker started (interval=%ss)", POLL_INTERVAL_SECONDS)
    while True:
        run_once(session_factory)
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
