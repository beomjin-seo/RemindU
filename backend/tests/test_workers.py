from app.workers.notifications import build_push_payload, should_notify


def test_push_payload_matches_apns_contract():
    payload = build_push_payload(
        title="Price drop", body="Now 99,000 KRW", card_id="card1", kind="price"
    )
    assert payload == {
        "aps": {"alert": {"title": "Price drop", "body": "Now 99,000 KRW"}, "sound": "default"},
        "card_id": "card1",
        "kind": "price",
    }


def test_digest_payload_allows_empty_card_id():
    payload = build_push_payload(title="Weekly digest", body="3 saved items", card_id="", kind="digest")
    assert payload["card_id"] == ""
    assert payload["kind"] == "digest"


def test_should_notify_is_conservative():
    assert should_notify(
        link_verified=True, confidence="high", previous_price=100000, current_price=85000
    )
    # Unknown or unverified data -> no push, never a guess.
    assert not should_notify(
        link_verified=False, confidence="high", previous_price=100000, current_price=50000
    )
    assert not should_notify(
        link_verified=True, confidence="medium", previous_price=100000, current_price=50000
    )
    assert not should_notify(
        link_verified=True, confidence="high", previous_price=None, current_price=50000
    )
    assert not should_notify(
        link_verified=True, confidence="high", previous_price=100000, current_price=95000
    )
