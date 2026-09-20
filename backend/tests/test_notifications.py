from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db import create_tables, make_engine, make_session_factory
from app.models import Card, Device, NotificationLog
from app.pipeline.deadlines import SEOUL
from app.workers import price_tracker
from app.workers.apns import FakePushSender
from app.workers.notifications import notify_install_devices, run_once, send_resolved_push

# Friday evening inside the D-1 window; Sunday evening for the digest.
FRIDAY_2000 = datetime(2026, 9, 11, 20, 0, tzinfo=SEOUL)
SATURDAY_2000 = FRIDAY_2000 + timedelta(days=1)
SUNDAY_2000 = datetime(2026, 9, 13, 20, 0, tzinfo=SEOUL)
INSTALL = "install-a"


@pytest.fixture
def session_factory(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'notifications.db'}")
    create_tables(engine)
    return make_session_factory(engine)


def add_device(session_factory, token="tok1", install_id=INSTALL) -> None:
    with session_factory() as session:
        session.add(Device(apns_token=token, install_id=install_id))
        session.commit()


def add_shopping_card(
    session_factory,
    *,
    deadline_at: datetime | None,
    created_at: datetime,
    verified=False,
    install_id=INSTALL,
    status="resolved",
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
        install_id=install_id,
        type="shopping",
        status=status,
        title="Nike Air Max 97",
        payload=payload,
        created_at=created_at.astimezone(timezone.utc).replace(tzinfo=None),
    )
    with session_factory() as session:
        session.add(card)
        session.commit()
    return card


def add_generic_card(session_factory, title: str, created_at: datetime, install_id=INSTALL) -> None:
    with session_factory() as session:
        session.add(
            Card(
                capture_id="cap",
                install_id=install_id,
                type="generic",
                title=title,
                payload={"ocr_text": title},
                created_at=created_at.astimezone(timezone.utc).replace(tzinfo=None),
            )
        )
        session.commit()


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


def test_same_day_deadline_says_today(session_factory):
    # Captured at 19:00 with a 23:59 deadline the same day: the 20:00 run
    # must not call it "tomorrow".
    add_device(session_factory)
    add_shopping_card(
        session_factory,
        deadline_at=FRIDAY_2000.replace(hour=23, minute=59),
        created_at=FRIDAY_2000 - timedelta(hours=1),
    )
    sender = FakePushSender()
    run_once(session_factory, sender, now=FRIDAY_2000)
    assert [p["aps"]["alert"]["title"] for _, p in sender.sent] == ["오늘 마감: Nike Air Max 97"]


def test_deadline_two_days_out_waits_for_the_next_evening(session_factory):
    # Sunday 07:00 is inside Friday's 36h horizon but is not "tomorrow" yet.
    add_device(session_factory)
    add_shopping_card(
        session_factory,
        deadline_at=SUNDAY_2000.replace(hour=7, minute=0),
        created_at=FRIDAY_2000 - timedelta(days=1),
    )
    sender = FakePushSender()

    run_once(session_factory, sender, now=FRIDAY_2000)
    assert sender.sent == []
    assert logged_kinds(session_factory) == []

    run_once(session_factory, sender, now=SATURDAY_2000)
    assert [p["aps"]["alert"]["title"] for _, p in sender.sent] == ["내일 마감: Nike Air Max 97"]


def test_cards_without_explicit_deadline_never_alert(session_factory):
    add_device(session_factory)
    add_shopping_card(session_factory, deadline_at=None, created_at=FRIDAY_2000 - timedelta(days=1))
    sender = FakePushSender()
    run_once(session_factory, sender, now=FRIDAY_2000)
    assert sender.sent == []


def test_rejected_cards_never_alert(session_factory, monkeypatch):
    add_device(session_factory)
    add_shopping_card(
        session_factory,
        deadline_at=datetime(2026, 9, 12, 23, 59, tzinfo=SEOUL),
        created_at=FRIDAY_2000 - timedelta(days=2),
        verified=True,
        status="rejected",
    )
    monkeypatch.setattr(price_tracker, "parse_price", lambda html: 99000)
    sender = FakePushSender()

    run_once(session_factory, sender, now=FRIDAY_2000)
    assert price_tracker.run_once(session_factory, sender, now=FRIDAY_2000) == 0
    run_once(session_factory, sender, now=SUNDAY_2000)
    assert sender.sent == []
    assert logged_kinds(session_factory) == []


def test_pushes_target_only_the_owning_install(session_factory):
    add_device(session_factory, "tok-a", "install-a")
    add_device(session_factory, "tok-b", "install-b")
    add_shopping_card(
        session_factory,
        deadline_at=datetime(2026, 9, 12, 23, 59, tzinfo=SEOUL),
        created_at=FRIDAY_2000 - timedelta(days=2),
        install_id="install-a",
    )
    sender = FakePushSender()
    run_once(session_factory, sender, now=FRIDAY_2000)
    assert [token for token, _ in sender.sent] == ["tok-a"]


def test_push_without_a_device_for_the_install_is_not_logged(session_factory):
    # Nothing is reserved for an install that cannot receive it, so a device
    # registered later the same evening still gets the alert.
    add_device(session_factory, "tok-b", "install-b")
    card = add_shopping_card(
        session_factory,
        deadline_at=datetime(2026, 9, 12, 23, 59, tzinfo=SEOUL),
        created_at=FRIDAY_2000 - timedelta(days=2),
        install_id="install-a",
    )
    sender = FakePushSender()
    run_once(session_factory, sender, now=FRIDAY_2000)
    assert sender.sent == []
    assert logged_kinds(session_factory) == []

    add_device(session_factory, "tok-a", "install-a")
    run_once(session_factory, sender, now=FRIDAY_2000 + timedelta(minutes=30))
    assert [token for token, _ in sender.sent] == ["tok-a"]
    assert logged_kinds(session_factory) == [(card.id, "deadline")]


def test_digest_with_zero_cards_sends_nothing(session_factory):
    add_device(session_factory)
    sender = FakePushSender()
    run_once(session_factory, sender, now=SUNDAY_2000)
    assert sender.sent == []
    assert logged_kinds(session_factory) == []


def test_digest_with_cards_sends_one_push(session_factory):
    add_device(session_factory)
    for days_ago, title in [(1, "최근 카드"), (3, "중간 카드"), (5, "오래된 카드"), (6, "네번째 카드")]:
        add_generic_card(session_factory, title, SUNDAY_2000 - timedelta(days=days_ago))
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


def test_digest_is_per_install(session_factory):
    add_device(session_factory, "tok-a", "install-a")
    add_device(session_factory, "tok-b", "install-b")
    add_device(session_factory, "tok-c", "install-c")  # saved nothing this week
    add_generic_card(session_factory, "A의 카드", SUNDAY_2000 - timedelta(days=1), "install-a")
    add_generic_card(session_factory, "B의 카드 1", SUNDAY_2000 - timedelta(days=2), "install-b")
    add_generic_card(session_factory, "B의 카드 2", SUNDAY_2000 - timedelta(days=3), "install-b")
    sender = FakePushSender()

    run_once(session_factory, sender, now=SUNDAY_2000)
    by_token = {token: payload["aps"]["alert"] for token, payload in sender.sent}
    assert by_token == {
        "tok-a": {"title": "이번 주 저장 1개", "body": "A의 카드"},
        "tok-b": {"title": "이번 주 저장 2개", "body": "B의 카드 1 · B의 카드 2"},
    }

    run_once(session_factory, sender, now=SUNDAY_2000 + timedelta(hours=1))
    assert len(sender.sent) == 2


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
    add_device(session_factory, "other", "install-b")
    sender = FakePushSender(results_by_token={"dead": "unregistered"})

    assert notify_install_devices(session_factory, sender, {"kind": "digest"}, INSTALL) == 2
    with session_factory() as session:
        tokens = session.scalars(select(Device.apns_token)).all()
    assert tokens == ["alive", "other"]


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


def test_resolved_push_title_reflects_what_was_found(session_factory):
    add_device(session_factory)
    sender = FakePushSender()
    fallback = add_shopping_card(session_factory, deadline_at=None, created_at=FRIDAY_2000)
    send_resolved_push(session_factory, sender, fallback)

    with session_factory() as session:
        pinned = Card(
            capture_id="cap", install_id=INSTALL, type="place", title="어니언 성수",
            payload={"name": "어니언 성수", "lat": 37.5, "lng": 127.0, "address": "성수동"},
        )
        unpinned = Card(
            capture_id="cap", install_id=INSTALL, type="place", title="어딘가",
            payload={"name": "어딘가", "lat": None, "lng": None},
        )
        note = Card(
            capture_id="cap", install_id=INSTALL, type="generic", title="메모",
            payload={"ocr_text": "메모"},
        )
        session.add_all([pinned, unpinned, note])
        session.commit()
    for card in (pinned, unpinned, note):
        send_resolved_push(session_factory, sender, card)

    assert [p["aps"]["alert"]["title"] for _, p in sender.sent] == [
        "저장했어요: Nike Air Max 97",
        "찾았어요: 어니언 성수",
        "저장했어요: 어딘가",
        "저장했어요: 메모",
    ]


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
