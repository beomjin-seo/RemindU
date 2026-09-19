import json

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.workers.apns import JWT_TTL_SECONDS, ApnsSender, build_push_payload

PAYLOAD = build_push_payload("찾았어요: Nike", "129,000원 · nike.com", "card1", "resolved")


@pytest.fixture
def key_pair(tmp_path):
    private_key = ec.generate_private_key(ec.SECP256R1())
    pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    key_path = tmp_path / "AuthKey_KEY123.p8"
    key_path.write_bytes(pem)
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return key_path, public_pem


class Clock:
    def __init__(self, value: float = 1_700_000_000.0):
        self.value = value

    def __call__(self) -> float:
        return self.value


def make_sender(key_path, responses, clock=None, **kwargs) -> tuple[ApnsSender, list[httpx.Request]]:
    requests: list[httpx.Request] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, Exception):
            raise item
        status, body = item
        return httpx.Response(status, json=body) if body is not None else httpx.Response(status)

    sender = ApnsSender(
        key_id="KEY123",
        team_id="TEAM456",
        auth_key_path=str(key_path),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        clock=clock or Clock(),
        **kwargs,
    )
    return sender, requests


def test_unconfigured_sender_logs_and_returns_without_network():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("unconfigured sender must not touch the network")

    sender = ApnsSender(
        key_id=None,
        team_id="TEAM",
        auth_key_path=None,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    assert sender.configured is False
    assert sender.send("abc", PAYLOAD) == "unconfigured"


def test_send_builds_token_auth_request(key_pair):
    key_path, public_pem = key_pair
    clock = Clock()
    sender, requests = make_sender(key_path, [(200, None)], clock=clock)

    assert sender.send("dead" * 16, PAYLOAD) == "sent"

    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://api.sandbox.push.apple.com/3/device/" + "dead" * 16
    assert request.headers["apns-topic"] == "com.captureinbox.app"
    assert request.headers["apns-push-type"] == "alert"
    assert request.headers["apns-priority"] == "10"
    assert json.loads(request.content) == PAYLOAD

    scheme, token = request.headers["authorization"].split(" ", 1)
    assert scheme == "bearer"
    assert jwt.get_unverified_header(token) == {"alg": "ES256", "kid": "KEY123", "typ": "JWT"}
    claims = jwt.decode(token, public_pem, algorithms=["ES256"])
    assert claims == {"iss": "TEAM456", "iat": int(clock.value)}


def test_production_host_and_custom_bundle_id(key_pair):
    key_path, _ = key_pair
    sender, requests = make_sender(
        key_path, [(200, None)], use_sandbox=False, bundle_id="com.example.other"
    )
    sender.send("tok", PAYLOAD)
    assert str(requests[0].url) == "https://api.push.apple.com/3/device/tok"
    assert requests[0].headers["apns-topic"] == "com.example.other"


def test_provider_token_is_cached_for_fifty_minutes(key_pair):
    key_path, _ = key_pair
    clock = Clock()
    sender, requests = make_sender(key_path, [(200, None)], clock=clock)

    sender.send("tok", PAYLOAD)
    clock.value += JWT_TTL_SECONDS - 1
    sender.send("tok", PAYLOAD)
    clock.value += 1
    sender.send("tok", PAYLOAD)

    tokens = [r.headers["authorization"] for r in requests]
    assert tokens[0] == tokens[1]
    assert tokens[2] != tokens[0]


def test_410_reports_unregistered(key_pair):
    key_path, _ = key_pair
    sender, _ = make_sender(key_path, [(410, {"reason": "Unregistered", "timestamp": 1})])
    assert sender.send("tok", PAYLOAD) == "unregistered"


def test_other_errors_never_raise(key_pair):
    key_path, _ = key_pair
    sender, _ = make_sender(key_path, [(400, {"reason": "BadDeviceToken"})])
    assert sender.send("tok", PAYLOAD) == "failed"

    sender, _ = make_sender(key_path, [httpx.ConnectError("boom")])
    assert sender.send("tok", PAYLOAD) == "failed"


def test_expired_provider_token_is_refreshed_once(key_pair):
    key_path, _ = key_pair
    sender, requests = make_sender(
        key_path, [(403, {"reason": "ExpiredProviderToken"}), (200, None)]
    )
    assert sender.send("tok", PAYLOAD) == "sent"
    assert len(requests) == 2
