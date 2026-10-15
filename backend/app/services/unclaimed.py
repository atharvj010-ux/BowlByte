"""Pickup holds for food that is READY and not collected.

UNCLAIMED is an order status. It keeps the READY timestamp, the payment row,
and the consumed stock. It does not reverse cash, write waste, restore
inventory, or decide that the food is safe. A manager review is an audit
event. Extending the hold returns the order to READY and requires a new QR.
A stale credential cannot pass the READY check.
"""

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.identity import Canteen, User
from app.models.ordering import Order, OrderHoldEvent
from app.services.notifications import enqueue_student_notice
from app.services.ordering import manager_canteen_id

SWEEP_LIMIT = 50


def arm_pickup_hold(db: Session, order: Order, now: datetime) -> None:
    """Set the collection deadline when the kitchen marks an order READY."""

    minutes = db.scalar(select(Canteen.pickup_hold_minutes).where(Canteen.id == order.canteen_id))
    hold = int(minutes or get_settings().pickup_hold_default_minutes)
    order.pickup_hold_until = now + timedelta(minutes=hold)
    order.unclaimed_at = None
    order.unclaimed_warned_at = None


def sweep_pickup_holds(db: Session, now: datetime) -> dict:
    """Warn, then mark overdue READY orders. Safe to run again.

    Each order is locked. A concurrent pickup that already committed
    PICKED_UP is left alone. A pickup that commits after this function
    sees UNCLAIMED and is rejected.
    """

    settings = get_settings()
    lead = timedelta(minutes=settings.pickup_hold_warn_lead_minutes)
    warned = _warn(db, now, lead)
    marked = _mark(db, now)
    db.commit()
    return {"warned": warned, "unclaimed": marked}


def _warn(db: Session, now: datetime, lead: timedelta) -> int:
    due = list(
        db.scalars(
            select(Order)
            .where(
                Order.status == "READY",
                Order.pickup_hold_until.is_not(None),
                Order.unclaimed_warned_at.is_(None),
                Order.pickup_hold_until > now,
                Order.pickup_hold_until <= now + lead,
            )
            .order_by(Order.id)
            .limit(SWEEP_LIMIT)
            .with_for_update()
        )
    )
    count = 0
    for order in due:
        if order.status != "READY" or order.unclaimed_warned_at is not None:
            continue
        order.unclaimed_warned_at = now
        db.add(
            OrderHoldEvent(
                order_id=order.id,
                canteen_id=order.canteen_id,
                actor_user_id=None,
                action="WARNED",
                note="Pickup hold is close to expiring.",
                created_at=now,
            )
        )
        enqueue_student_notice(
            db,
            order,
            now,
            kind="PICKUP_HOLD_WARNING",
            title="Collect your order soon",
            body=(
                f"Order {order.ticket_number} is ready. "
                "Collect it before the pickup hold ends, or ask the counter."
            ),
        )
        count += 1
    return count


def _mark(db: Session, now: datetime) -> int:
    due = list(
        db.scalars(
            select(Order)
            .where(
                Order.status == "READY",
                Order.pickup_hold_until.is_not(None),
                Order.pickup_hold_until <= now,
            )
            .order_by(Order.id)
            .limit(SWEEP_LIMIT)
            .with_for_update()
        )
    )
    count = 0
    for order in due:
        if order.status != "READY":
            continue
        if order.pickup_hold_until is None or order.pickup_hold_until > now:
            continue
        order.status = "UNCLAIMED"
        order.unclaimed_at = now
        order.version += 1
        order.updated_at = now
        db.add(
            OrderHoldEvent(
                order_id=order.id,
                canteen_id=order.canteen_id,
                actor_user_id=None,
                action="UNCLAIMED",
                note="Pickup hold elapsed. Payment and stock were not changed.",
                created_at=now,
            )
        )
        enqueue_student_notice(
            db,
            order,
            now,
            kind="PICKUP_UNCLAIMED",
            title="Pickup hold ended",
            body=(
                f"Order {order.ticket_number} was not collected in time. "
                "A manager must review it. This is not a refund."
            ),
        )
        count += 1
    return count


def list_unclaimed(db: Session, *, manager: User, limit: int) -> list[dict]:
    canteen_id = manager_canteen_id(db, manager)
    rows = list(
        db.scalars(
            select(Order)
            .where(Order.canteen_id == canteen_id, Order.status == "UNCLAIMED")
            .order_by(Order.unclaimed_at.asc().nulls_last(), Order.ticket_number)
            .limit(limit)
        )
    )
    return [_payload(db, order) for order in rows]


def extend_hold(
    db: Session,
    *,
    manager: User,
    order_id: UUID,
    minutes: int,
    note: str,
    now: datetime,
) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    order = _lock(db, order_id, canteen_id)
    if order.status != "UNCLAIMED":
        raise ApiError(
            code="CONFLICT",
            message="Only an unclaimed order can have its pickup hold extended.",
            status_code=409,
        )
    if minutes < 5 or minutes > 180:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="An extension must be between 5 and 180 minutes.",
            status_code=422,
        )
    order.status = "READY"
    order.pickup_hold_until = now + timedelta(minutes=minutes)
    order.unclaimed_at = None
    order.unclaimed_warned_at = None
    order.version += 1
    order.updated_at = now
    db.add(
        OrderHoldEvent(
            order_id=order.id,
            canteen_id=order.canteen_id,
            actor_user_id=manager.id,
            action="EXTENDED",
            note=note.strip()[:240],
            created_at=now,
        )
    )
    db.commit()
    db.refresh(order)
    return _payload(db, order)


def review_hold(
    db: Session,
    *,
    manager: User,
    order_id: UUID,
    note: str,
    now: datetime,
) -> dict:
    """Record a decision without changing payment, stock, or waste."""

    canteen_id = manager_canteen_id(db, manager)
    order = _lock(db, order_id, canteen_id)
    if order.status != "UNCLAIMED":
        raise ApiError(
            code="CONFLICT",
            message="Only an unclaimed order can be reviewed this way.",
            status_code=409,
        )
    cleaned = note.strip()
    if len(cleaned) < 8:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Write a short note about what the counter decided.",
            status_code=422,
        )
    db.add(
        OrderHoldEvent(
            order_id=order.id,
            canteen_id=order.canteen_id,
            actor_user_id=manager.id,
            action="REVIEWED",
            note=cleaned[:240],
            created_at=now,
        )
    )
    db.commit()
    return _payload(db, order)


def update_hold_policy(db: Session, *, manager: User, minutes: int) -> dict:
    if minutes < 5 or minutes > 180:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="The pickup hold must be between 5 and 180 minutes.",
            status_code=422,
        )
    canteen_id = manager_canteen_id(db, manager)
    canteen = db.get(Canteen, canteen_id)
    if canteen is None:
        raise ApiError(code="NOT_FOUND", message="Canteen not found.", status_code=404)
    canteen.pickup_hold_minutes = minutes
    db.commit()
    return {"pickup_hold_minutes": minutes}


def _lock(db: Session, order_id: UUID, canteen_id: UUID) -> Order:
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None or order.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    return order


def _payload(db: Session, order: Order) -> dict:
    events = list(
        db.scalars(
            select(OrderHoldEvent)
            .where(OrderHoldEvent.order_id == order.id)
            .order_by(OrderHoldEvent.created_at)
        )
    )
    return {
        "id": order.id,
        "ticket_number": order.ticket_number,
        "status": order.status,
        "ready_at": order.ready_at,
        "pickup_hold_until": order.pickup_hold_until,
        "unclaimed_at": order.unclaimed_at,
        "payment_method": order.payment_method,
        "total_paise": order.total_paise,
        "events": [
            {
                "action": event.action,
                "note": event.note,
                "created_at": event.created_at,
            }
            for event in events
        ],
    }
