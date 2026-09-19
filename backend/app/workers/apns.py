"""APNs delivery: token-based auth (ES256 provider JWT) over HTTP/2.

Push payload contract (see docs/api.md):
{"aps": {"alert": {"title", "body"}, "sound": "default"}, "card_id", "kind"}
"""

import logging
import time
from typing import Callable, Literal, Protocol

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

PushKind = Literal["resolved", "deadline", "price", "digest"]
# "unregistered" = APNs 410: the token is dead and its Device row must go.
SendResult = Literal["sent", "unconfigured", "unregistered", "failed"]

APNS_HOST = "https://api.push.apple.com"
APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com"
JWT_TTL_SECONDS = 50 * 60  # APNs rejects provider tokens older than an hour
_TIMEOUT = 10.0


def build_push_payload(title: str, body: str, card_id: str, kind: PushKind) -> dict:
    # card_id may be "" for digest pushes that do not target one card.
    return {
        "aps": {"alert": {"title": title, "body": body}, "sound": "default"},
        "card_id": card_id,
        "kind": kind,
    }


class PushSender(Protocol):
    def send(self, apns_token: str, payload: dict) -> SendResult: ...


class FakePushSender:
    """Records pushes instead of delivering them; per-token results let tests
    simulate a dead token ("unregistered")."""

    def __init__(
        self, result: SendResult = "sent", results_by_token: dict[str, SendResult] | None = None
    ) -> None:
        self.sent: list[tuple[str, dict]] = []
        self._result = result
        self._results_by_token = results_by_token or {}

    def send(self, apns_token: str, payload: dict) -> SendResult:
        self.sent.append((apns_token, payload))
        logger.info("push[fake] token=%s... payload=%s", apns_token[:8], payload)
        return self._results_by_token.get(apns_token, self._result)


class ApnsSender:
    """send() never raises: unconfigured -> "unconfigured", transport or APNs
    errors -> "failed", HTTP 410 -> "unregistered" (caller deletes the device)."""

    def __init__(
        self,
        key_id: str | None,
        team_id: str | None,
        auth_key_path: str | None,
        bundle_id: str = "com.captureinbox.app",
        use_sandbox: bool = True,
        *,
        client: httpx.Client | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._key_id = key_id
        self._team_id = team_id
        self._auth_key_path = auth_key_path
        self._bundle_id = bundle_id
        self._host = APNS_SANDBOX_HOST if use_sandbox else APNS_HOST
        self._client = client
        self._clock = clock
        self._private_key: str | None = None
        self._jwt: str | None = None
        self._jwt_issued_at = 0.0

    @classmethod
    def from_settings(cls, settings: Settings) -> "ApnsSender":
        return cls(
            key_id=settings.apns_key_id,
            team_id=settings.apns_team_id,
            auth_key_path=settings.apns_auth_key_path,
            bundle_id=settings.apns_bundle_id,
            use_sandbox=settings.apns_use_sandbox,
        )

    @property
    def configured(self) -> bool:
        return bool(self._key_id and self._team_id and self._auth_key_path)

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(http2=True, timeout=_TIMEOUT)
        return self._client

    def _provider_token(self) -> str:
        import jwt

        now = self._clock()
        if self._jwt is None or now - self._jwt_issued_at >= JWT_TTL_SECONDS:
            if self._private_key is None:
                with open(self._auth_key_path, encoding="utf-8") as handle:  # type: ignore[arg-type]
                    self._private_key = handle.read()
            self._jwt = jwt.encode(
                {"iss": self._team_id, "iat": int(now)},
                self._private_key,
                algorithm="ES256",
                headers={"kid": self._key_id},
            )
            self._jwt_issued_at = now
        return self._jwt

    def _post(self, apns_token: str, payload: dict) -> httpx.Response:
        headers = {
            "authorization": f"bearer {self._provider_token()}",
            "apns-topic": self._bundle_id,
            "apns-push-type": "alert",
            "apns-priority": "10",
        }
        return self._get_client().post(
            f"{self._host}/3/device/{apns_token}", json=payload, headers=headers
        )

    def send(self, apns_token: str, payload: dict) -> SendResult:
        if not self.configured:
            logger.info("push[unconfigured] token=%s... payload=%s", apns_token[:8], payload)
            return "unconfigured"
        try:
            response = self._post(apns_token, payload)
            if response.status_code == 403 and _reason(response) == "ExpiredProviderToken":
                self._jwt = None
                response = self._post(apns_token, payload)
        except Exception:
            logger.exception("apns request failed token=%s...", apns_token[:8])
            return "failed"

        if response.status_code == 200:
            return "sent"
        if response.status_code == 410:
            logger.info("apns token unregistered token=%s...", apns_token[:8])
            return "unregistered"
        logger.warning(
            "apns rejected token=%s... status=%s reason=%s",
            apns_token[:8],
            response.status_code,
            _reason(response) or response.text,
        )
        return "failed"

    def close(self) -> None:
        if self._client is not None:
            self._client.close()


def _reason(response: httpx.Response) -> str | None:
    try:
        return response.json().get("reason")
    except Exception:
        return None
