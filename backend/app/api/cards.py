from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from sqlalchemy import or_, select

from app.models import Card, Feedback
from app.schemas import CardListOut, CardOut, FeedbackIn

router = APIRouter(prefix="/v1/cards", tags=["cards"])


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
) -> CardListOut:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        query = select(Card).order_by(Card.created_at.desc(), Card.id.desc())
        if type is not None:
            query = query.where(Card.type == type)
        if cursor is not None:
            anchor = session.get(Card, cursor)
            if anchor is None:
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
def get_card(card_id: str, request: Request) -> CardOut:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        card = session.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="card not found")
        return card_to_out(card)


@router.post("/{card_id}/feedback", status_code=204)
def create_feedback(card_id: str, feedback: FeedbackIn, request: Request) -> Response:
    # Feedback is stored: wrong-link rate is a first-class quality metric.
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        card = session.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="card not found")
        session.add(Feedback(card_id=card_id, kind=feedback.kind))
        session.commit()
    return Response(status_code=204)
