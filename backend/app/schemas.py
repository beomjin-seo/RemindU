from datetime import datetime
from typing import Literal

from pydantic import BaseModel


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
