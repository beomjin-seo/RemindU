import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _new_id() -> str:
    return uuid.uuid4().hex


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Capture(Base):
    __tablename__ = "captures"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    status: Mapped[str] = mapped_column(String(16), default="processing")
    source_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Newline-separated lines recognized on-device; the default extraction input.
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_path: Mapped[str] = mapped_column(Text)
    card_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Set with status="failed": "no_text" | "extraction_failed" | "pipeline_failed".
    failure_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    capture_id: Mapped[str] = mapped_column(String(32), index=True)
    type: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="resolved")
    title: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    card_id: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    apns_token: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class NotificationLog(Base):
    """One row per push trigger, so the same trigger never fires twice.
    card_id is NULL for digests (NULLs are distinct under the unique
    constraint, so digests are limited by sent_at instead)."""

    __tablename__ = "notification_log"
    __table_args__ = (UniqueConstraint("card_id", "kind", name="uq_notification_card_kind"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    card_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # "resolved" | "deadline" | "price" | "digest"
    kind: Mapped[str] = mapped_column(String(16))
    # Naive UTC.
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
