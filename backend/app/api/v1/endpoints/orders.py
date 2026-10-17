from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_principal
from app.core.errors import ApiError
from app.db.session import get_db
from app.schemas.ordering import OrderCreateRequest, OrderListResponse, OrderResponse
from app.services.identity import Principal
from app.services.ordering import (
    cancel_order,
    get_student_order,
    list_kitchen_orders,
    list_student_orders,
    place_order,
)
from app.services.rate_limit import consume_allowance

router = APIRouter(tags=["orders"])


def _page(limit: int, offset: int) -> tuple[int, int]:
    return min(max(limit, 1), 50), max(offset, 0)


def _student(principal: Principal) -> Principal:
    if principal.user.role != "STUDENT":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    return principal


def _kitchen(principal: Principal) -> Principal:
    if principal.user.role != "KITCHEN_STAFF":
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    return principal


@router.post("/orders", response_model=OrderResponse, status_code=201)
def create_order(
    body: OrderCreateRequest,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OrderResponse:
    _student(principal)
    consume_allowance(
        bucket="order-user",
        value=str(principal.user.id),
        limit=20,
        window_seconds=10 * 60,
        unavailable_message="Ordering is temporarily unavailable.",
        limited_message="Too many orders were submitted. Wait and try again.",
    )
    saved = place_order(
        db,
        student=principal.user,
        lines=[(line.menu_item_id, line.quantity) for line in body.items],
        note=body.note,
        idempotency_key=body.idempotency_key,
    )
    return OrderResponse.model_validate(saved)


@router.get("/orders", response_model=OrderListResponse)
def my_orders(
    limit: int = Query(default=20),
    offset: int = Query(default=0),
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> OrderListResponse:
    _student(principal)
    bounded_limit, bounded_offset = _page(limit, offset)
    orders, total = list_student_orders(
        db,
        student=principal.user,
        limit=bounded_limit,
        offset=bounded_offset,
    )
    return OrderListResponse(
        orders=[OrderResponse.model_validate(order) for order in orders],
        total=total,
        limit=bounded_limit,
        offset=bounded_offset,
    )


@router.get("/orders/{order_id}", response_model=OrderResponse)
def my_order(
    order_id: UUID,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> OrderResponse:
    _student(principal)
    return OrderResponse.model_validate(
        get_student_order(db, student=principal.user, order_id=order_id)
    )


@router.post("/orders/{order_id}/cancel", response_model=OrderResponse)
def cancel_my_order(
    order_id: UUID,
    principal: Principal = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OrderResponse:
    _student(principal)
    return OrderResponse.model_validate(cancel_order(db, student=principal.user, order_id=order_id))


@router.get("/staff/orders", response_model=OrderListResponse)
def incoming_orders(
    limit: int = Query(default=20),
    offset: int = Query(default=0),
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
) -> OrderListResponse:
    _kitchen(principal)
    bounded_limit, bounded_offset = _page(limit, offset)
    orders, total = list_kitchen_orders(
        db,
        staff=principal.user,
        limit=bounded_limit,
        offset=bounded_offset,
    )
    return OrderListResponse(
        orders=[OrderResponse.model_validate(order) for order in orders],
        total=total,
        limit=bounded_limit,
        offset=bounded_offset,
    )
