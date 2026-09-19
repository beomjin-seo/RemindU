from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db import create_tables, make_engine, make_session_factory
from app.models import Card, Device, NotificationLog
from app.pipeline.deadlines import SEOUL
from app.workers import price_tracker
from app.workers.apns import FakePushSender
from app.workers.notifications import notify_all_devices, run_once, send_resolved_push

# Friday evening inside the D-1 window; Sunday evening for the digest.
FRIDAY_2000 = datetime(2026, 9, 11, 20, 0, tzinfo=SEOUL)
SUNDAY_2000 = datetime(2026, 9, 13, 20, 0, tzinfo=SEOUL)


@pytest.fixture
def session_factory(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'notifications.db'}")
    create_tables(engine)
    return make_session_factory(engine)


def add_device(session_factory, token="tok1") -> None:
    with session_factory() as session:
        session.add(Device(apns_token=token))
        session.commit()


def add_shopping_card(
    session_factory, *, deadline_at: datetime | None, created_at: datetime, verified=False
) -> Card:
    payload = {
        "product_name": "Nike Air Max 97",
        "price": 129000,
        "currency": "KRW",
        "confidence": "high",
        "deadline_text": "9월 12일까지" if deadline_at else None,
        "deadline_at": deadline_at.isoformat() if deadline_at else None,
        "link": {
            "url": "https://www.musinsa.com/p/1",
            "domain": "www.musinsa.com",
            "verified": verified,
            "kind": "product" if verified else "search_results",
            "trusted": True,
        },
        "candidates": [],
    }
    card = Card(
        capture_id="cap",
        type="shopping",
        title="Nike Air Max 97",
        payload=payload,
        created_at=created_at.astimezone(timezone.utc).replace(tzinfo=None),
    )
    with session_factory() as session:
        session.add(card)
        session.commit()
    return card


def logged_kinds(session_factory) -> list[tuple[str | None, str]]:
    with session_factory() as session:
        rows = session.scalars(select(NotificationLog)).all()
    return [(row.card_id, row.kind) for row in rows]


def test_deadline_push_fires_once_in_evening_window(session_factory):
    add_device(session_factory)
    card = add_shopping_card(
        session_factory,
        deadline_at=datetime(2026, 9, 12, 23, 59, tzinfo=SEOUL),
        created_at=FRIDAY_2000 - timedelta(days=2),
    )
    sender = FakePushSender()

    run_once(session_factory, sender, now=FRIDAY_2000)
    assert len(sender.sent) == 1
    token, payload = sender.sent[0]
    assert token == "tok1"
    assert payload == {
        "aps": {
            "alert": {"title": "내일 마감: Nike Air Max 97", "body": "9월 12일까지 · www.musinsa.com"},
            "sound": "default",
        },
        "card_id": card.id,
        "kind": "deadline",
    }
    assert logged_kinds(session_factory) == [(card.id, "deadline")]

    # Same evening, later poll -> no duplicate.
    run_once(session_factory, sender, now=FRIDAY_2000 + timedelta(minutes=45))
    assert len(sender.sent) == 1


def test_deadline_push_only_inside_window_and_horizon(session_factory):
    add_device(session_factory)
    add_shopping_card(
        session_factory,
        deadline_at=datetime(2026, 9, 12, 23, 59, tzinfo=SEOUL),
        created_at=FRIDAY_2000 - timedelta(days=2),
    )
    sender = FakePushSender()

    run_once(session_factory, sender, now=FRIDAY_2000.replace(hour=15))  # outside 19:30-21:30
    run_once(session_factory, sender, now=FRIDAY_2000 - timedelta(days=1))  # 52h ahead: too early
    run_once(session_factory, sender, now=FRIDAY_2000 + timedelta(days=3))  # Monday: passed
    assert sender.sent == []
    assert logged_kinds(session_factory) == []


def test_cards_without_explicit_deadline_never_alert(session_factory):
    add_device(session_factory)
    add_shopping_card(session_factory, deadline_at=None, created_at=FRIDAY_2000 - timedelta(days=1))
    sender = FakePushSender()
    run_once(session_factory, sender, now=FRIDAY_2000)
    assert sender.sent == []


def test_digest_with_zero_cards_sends_nothing(session_factory):
    add_device(session_factory)
    sender = FakePushSender()
    run_once(session_factory, sender, now=SUNDAY_2000)
    assert sender.sent == []
    assert logged_kinds(session_factory) == []


def test_digest_with_cards_sends_one_push(session_factory):
    add_device(session_factory)
    for days_ago, title in [(1, "최근 카드"), (3, "중간 카드"), (5, "오래된 카드"), (6, "네번째 카드")]:
        with session_factory() as session:
            session.add(
                Card(
                    capture_id="cap",
                    type="generic",
                    title=title,
                    payload={"ocr_text": title},
                    created_at=(SUNDAY_2000 - timedelta(days=days_ago))
                    .astimezone(timezone.utc)
                    .replace(tzinfo=None),
                )
            )
            session.commit()
    sender = FakePushSender()

    run_once(session_factory, sender, now=SUNDAY_2000)
    assert len(sender.sent) == 1
    _, payload = sender.sent[0]
    assert payload["kind"] == "digest"
    assert payload["card_id"] == ""
    assert payload["aps"]["alert"]["title"] == "이번 주 저장 4개"
    assert payload["aps"]["alert"]["body"] == "최근 카드 · 중간 카드 · 오래된 카드"
    assert logged_kinds(session_factory) == [(None, "digest")]

    # Second poll in the same window and a weekday evening -> nothing more.
    run_once(session_factory, sender, now=SUNDAY_2000 + timedelta(hours=1))
    run_once(session_factory, sender, now=SUNDAY_2000 + timedelta(days=2))
    assert len(sender.sent) == 1


def test_nothing_is_sent_or_logged_without_devices(session_factory):
    add_shopping_card(
        session_factory,
        deadline_at=datetime(2026, 9, 12, 23, 59, tzinfo=SEOUL),
        created_at=FRIDAY_2000 - timedelta(days=2),
    )
    sender = FakePushSender()
    run_once(session_factory, sender, now=FRIDAY_2000)
    assert sender.sent == []
    assert logged_kinds(session_factory) == []


def test_unregistered_token_deletes_device(session_factory):
    add_device(session_factory, "alive")
    add_device(session_factory, "dead")
    sender = FakePushSender(results_by_token={"dead": "unregistered"})

    assert notify_all_devices(session_factory, sender, {"kind": "digest"}) == 2
    with session_factory() as session:
        tokens = session.scalars(select(Device.apns_token)).all()
    assert tokens == ["alive"]


def test_resolved_push_helper_sends_once(session_factory):
    add_device(session_factory)
    card = add_shopping_card(
        session_factory, deadline_at=None, created_at=FRIDAY_2000, verified=True
    )
    sender = FakePushSender()

    assert send_resolved_push(session_factory, sender, card) is True
    assert send_resolved_push(session_factory, sender, card) is False
    assert len(sender.sent) == 1
    _, payload = sender.sent[0]
    assert payload["kind"] == "resolved"
    assert payload["card_id"] == card.id
    assert payload["aps"]["alert"] == {
        "title": "찾았어요: Nike Air Max 97",
        "body": "129,000원 · www.musinsa.com",
    }


def test_price_tracker_alerts_once_per_card(session_factory, monkeypatch):
    add_device(session_factory)
    card = add_shopping_card(
        session_factory, deadline_at=None, created_at=FRIDAY_2000, verified=True
    )
    monkeypatch.setattr(price_tracker, "parse_price", lambda html: 99000)
    sender = FakePushSender()

    assert price_tracker.run_once(session_factory, sender, now=FRIDAY_2000) == 1
    assert price_tracker.run_once(session_factory, sender, now=FRIDAY_2000 + timedelta(hours=6)) == 0
    assert len(sender.sent) == 1
    _, payload = sender.sent[0]
    assert payload["kind"] == "price"
    assert payload["card_id"] == card.id
    assert payload["aps"]["alert"] == {
        "title": "가격 인하: Nike Air Max 97",
        "body": "지금 99,000원 · www.musinsa.com",
    }
    assert logged_kinds(session_factory) == [(card.id, "price")]


def test_price_tracker_ignores_unverified_links_and_small_drops(session_factory, monkeypatch):
    add_device(session_factory)
    add_shopping_card(session_factory, deadline_at=None, created_at=FRIDAY_2000, verified=False)
    monkeypatch.setattr(price_tracker, "parse_price", lambda html: 50000)
    sender = FakePushSender()
    assert price_tracker.run_once(session_factory, sender, now=FRIDAY_2000) == 0

    add_shopping_card(session_factory, deadline_at=None, created_at=FRIDAY_2000, verified=True)
    monkeypatch.setattr(price_tracker, "parse_price", lambda html: 125000)  # ~3% drop
    assert price_tracker.run_once(session_factory, sender, now=FRIDAY_2000) == 0
    assert sender.sent == []
