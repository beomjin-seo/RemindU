from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, field_serializer


class Link(BaseModel):
    url: str
    domain: str
    verified: bool
    kind: Literal["product", "search_results"]


class ShoppingPayload(BaseModel):
    product_name: str
    brand: str | None = None
    price: int | None = None
    currency: str = "KRW"
    deadline_text: str | None = None
    deadline_at: datetime | None = None
    confidence: Literal["high", "medium", "low"]
    link: Link


class PlacePayload(BaseModel):
    name: str
    category: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    naver_place_url: str | None = None


class GenericPayload(BaseModel):
    ocr_text: str
    summary: str | None = None


class CardOut(BaseModel):
    id: str
    capture_id: str
    type: Literal["shopping", "place", "generic"]
    status: Literal["resolved", "failed"]
    title: str
    created_at: datetime
    shopping: ShoppingPayload | None = None
    place: PlacePayload | None = None
    generic: GenericPayload | None = None

    # DB datetimes come back naive (SQLite drops the timezone); the contract
    # promises ISO 8601 with timezone, and the iOS date decoder requires it.
    @field_serializer("created_at")
    def _created_at_utc(self, value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")


class CardListOut(BaseModel):
    cards: list[CardOut]
    next_cursor: str | None = None


class CaptureCreatedOut(BaseModel):
    capture_id: str
    status: Literal["processing"] = "processing"


class CaptureStatusOut(BaseModel):
    capture_id: str
    status: Literal["processing", "resolved", "failed"]
    card_id: str | None = None


class FeedbackIn(BaseModel):
    kind: Literal["not_this", "correct"]


class DeviceIn(BaseModel):
    apns_token: str
