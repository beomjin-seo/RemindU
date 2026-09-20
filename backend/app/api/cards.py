from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import or_, select

from app.api.auth import require_install_id
from app.models import Card, Feedback
from app.schemas import CardListOut, CardOut, FeedbackIn

router = APIRouter(prefix="/v1/cards", tags=["cards"])


def _owned_card(session, card_id: str, install_id: str) -> Card:
    # Another install's card is indistinguishable from a missing one.
    card = session.get(Card, card_id)
    if card is None or card.install_id != install_id:
        raise HTTPException(status_code=404, detail="card not found")
    return card


def card_to_out(card: Card) -> CardOut:
    payloads: dict = {"shopping": None, "place": None, "generic": None}
    payloads[card.type] = card.payload
    return CardOut(
        id=card.id,
        capture_id=card.capture_id,
        type=card.type,
        status=card.status,
        title=card.title,
        created_at=card.created_at,
        **payloads,
    )


@router.get("", response_model=CardListOut)
def list_cards(
    request: Request,
    type: Literal["shopping", "place", "generic"] | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    install_id: str = Depends(require_install_id),
) -> CardListOut:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        # Rejected ("not this") cards leave the feed for good.
        query = (
            select(Card)
            .where(Card.install_id == install_id, Card.status == "resolved")
            .order_by(Card.created_at.desc(), Card.id.desc())
        )
        if type is not None:
            query = query.where(Card.type == type)
        if cursor is not None:
            anchor = session.get(Card, cursor)
            if anchor is None or anchor.install_id != install_id:
                raise HTTPException(status_code=400, detail="invalid cursor")
            query = query.where(
                or_(
                    Card.created_at < anchor.created_at,
                    (Card.created_at == anchor.created_at) & (Card.id < anchor.id),
                )
            )
        cards = session.scalars(query.limit(limit)).all()
        next_cursor = cards[-1].id if len(cards) == limit else None
        return CardListOut(cards=[card_to_out(card) for card in cards], next_cursor=next_cursor)


@router.get("/{card_id}", response_model=CardOut)
def get_card(
    card_id: str, request: Request, install_id: str = Depends(require_install_id)
) -> CardOut:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        return card_to_out(_owned_card(session, card_id, install_id))


@router.post("/{card_id}/feedback", status_code=204)
def create_feedback(
    card_id: str,
    feedback: FeedbackIn,
    request: Request,
    install_id: str = Depends(require_install_id),
) -> Response:
    # Feedback is stored: wrong-link rate is a first-class quality metric.
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        card = _owned_card(session, card_id, install_id)
        session.add(Feedback(card_id=card_id, kind=feedback.kind))
        if feedback.kind == "not_this":
            # "Not this" is the explicit signal to stop resurfacing: the card
            # leaves the feed and every worker (deadline/price/digest) skips it.
            card.status = "rejected"
        session.commit()
    return Response(status_code=204)
