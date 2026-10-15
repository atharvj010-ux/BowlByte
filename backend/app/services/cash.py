"""Cash receipt, correction, and cashier-queue services.

Payment and preparation are separate state machines. A cashier moves a payment
from PENDING to PAID only for a READY order. A manager can reopen it to
PENDING with an appended reversal row, and only before pickup. The ledger rows
(`cash_receipts`, `cash_reversals`) are append-only and enforced by triggers.

Lock order for every money or pickup change: order, then payment, then the
ledger or credential row. Kitchen changes lock queued and preparing orders,
which a READY order is no longer part of, so the two paths cannot deadlock.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models.fulfillment import CashReceipt, CashReversal
from app.models.identity import User
from app.models.ordering import Order, OrderEvent, OrderItem, OrderPayment
from app.services.identity import _audit as audit
from app.services.ordering import cashier_canteen_id, manager_canteen_id
from app.services.realtime import publish_kitchen_event

Clock = Callable[[], datetime]


def utcnow() -> datetime:
    return datetime.now(UTC)


def receipt_ref(receipt_no: int) -> str:
    return f"CR-{receipt_no:06d}"


def lock_order(db: Session, order_id: UUID, canteen_id: UUID) -> Order:
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None or order.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    return order


def lock_payment(db: Session, order: Order) -> OrderPayment:
    payment = db.scalar(
        select(OrderPayment).where(OrderPayment.order_id == order.id).with_for_update()
    )
    if payment is None:
        raise ApiError(code="INTERNAL_ERROR", message="Order payment is missing.", status_code=500)
    return payment


def _first_name(user: User | None) -> str | None:
    if user is None or not user.full_name.strip():
        return None
    return user.full_name.split()[0]


def _event(db: Session, order: Order, actor_id: UUID, reason: str) -> None:
    # Payment changes are not order-state changes, so from and to stay equal.
    db.add(
        OrderEvent(
            order_id=order.id,
            from_status=order.status,
            to_status=order.status,
            actor_user_id=actor_id,
            reason=reason,
        )
    )


def _effective_receipt(db: Session, payment_id: UUID) -> CashReceipt | None:
    reversed_ids = select(CashReversal.receipt_id)
    return db.scalar(
        select(CashReceipt)
        .where(CashReceipt.payment_id == payment_id, CashReceipt.id.not_in(reversed_ids))
        .order_by(CashReceipt.attempt_no.desc())
        .limit(1)
    )


def _receipt_payload(db: Session, receipt: CashReceipt) -> dict:
    cashier = db.get(User, receipt.cashier_user_id)
    reversal = db.scalar(select(CashReversal).where(CashReversal.receipt_id == receipt.id))
    reversal_payload = None
    if reversal is not None:
        manager = db.get(User, reversal.manager_user_id)
        reversal_payload = {
            "id": reversal.id,
            "amount_paise": reversal.amount_paise,
            "kind": reversal.kind,
            "reason": reversal.reason,
            "reversed_at": reversal.reversed_at,
            "manager_user_id": reversal.manager_user_id,
            "manager_name": manager.full_name if manager else None,
        }
    return {
        "id": receipt.id,
        "receipt_no": receipt.receipt_no,
        "receipt_ref": receipt_ref(receipt.receipt_no),
        "order_id": receipt.order_id,
        "ticket_number": receipt.ticket_number,
        "amount_paise": receipt.amount_paise,
        "cashier_user_id": receipt.cashier_user_id,
        "cashier_name": cashier.full_name if cashier else None,
        "received_at": receipt.received_at,
        "reversed": reversal is not None,
        "reversal": reversal_payload,
    }


def confirm_cash(
    db: Session,
    *,
    cashier: User,
    order_id: UUID,
    acknowledged_amount_paise: int,
    idempotency_key: str,
    clock: Clock = utcnow,
) -> tuple[dict, bool]:
    """Record physical cash for a READY order. Returns (receipt, replayed)."""

    canteen_id = cashier_canteen_id(db, cashier)
    order = lock_order(db, order_id, canteen_id)
    payment = lock_payment(db, order)

    existing = db.scalar(
        select(CashReceipt).where(
            CashReceipt.payment_id == payment.id,
            CashReceipt.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.cashier_user_id != cashier.id:
            raise ApiError(
                code="CONFLICT",
                message="This cash entry was recorded by someone else.",
                status_code=409,
            )
        return _receipt_payload(db, existing), True

    if order.status == "PICKED_UP":
        raise ApiError(
            code="CONFLICT", message="This order has already been collected.", status_code=409
        )
    if order.status == "UNCLAIMED":
        raise ApiError(
            code="PICKUP_HOLD_EXPIRED",
            message=(
                "The pickup hold ended. Cash was not reversed. "
                "A manager must review the order before collection."
            ),
            status_code=409,
        )
    if order.status != "READY":
        raise ApiError(
            code="ORDER_NOT_READY",
            message="Cash can be confirmed only after the kitchen marks the order ready.",
            status_code=409,
        )
    if payment.method != "CASH":
        raise ApiError(code="CONFLICT", message="This payment is not cash.", status_code=409)
    if payment.status == "PAID":
        effective = _effective_receipt(db, payment.id)
        raise ApiError(
            code="ALREADY_PAID",
            message="Cash for this order was already recorded.",
            status_code=409,
            details={"receipt_ref": receipt_ref(effective.receipt_no)} if effective else {},
        )
    if payment.status != "PENDING":
        raise ApiError(
            code="CONFLICT", message="This payment cannot be confirmed.", status_code=409
        )
    if payment.amount_paise != order.total_paise:
        raise ApiError(
            code="CONFLICT",
            message="The stored payment amount does not match the order total.",
            status_code=409,
        )
    if acknowledged_amount_paise != order.total_paise:
        raise ApiError(
            code="AMOUNT_MISMATCH",
            message="The amount you confirmed does not match the order total. Reload the order.",
            status_code=409,
            details={"amount_paise": order.total_paise},
        )

    now = clock()
    attempt_no = (
        db.scalar(
            select(func.coalesce(func.max(CashReceipt.attempt_no), 0)).where(
                CashReceipt.payment_id == payment.id
            )
        )
        or 0
    ) + 1
    receipt_no = int(db.scalar(text("SELECT nextval('cash_receipt_no_seq')")) or 0)
    receipt = CashReceipt(
        receipt_no=receipt_no,
        order_id=order.id,
        canteen_id=canteen_id,
        payment_id=payment.id,
        attempt_no=attempt_no,
        amount_paise=order.total_paise,
        cashier_user_id=cashier.id,
        received_at=now,
        idempotency_key=idempotency_key,
        ticket_number=order.ticket_number,
        metadata_json={"method": "CASH", "order_version": order.version},
    )
    db.add(receipt)
    payment.status = "PAID"
    payment.paid_at = now
    payment.paid_by = cashier.id
    order.version += 1
    order.updated_at = now
    _event(db, order, cashier.id, f"cash_received:{receipt_ref(receipt_no)}")
    audit(
        db,
        action="cash.confirmed",
        actor_user_id=cashier.id,
        target_type="order",
        target_id=str(order.id),
        canteen_id=canteen_id,
        metadata={"receipt_no": receipt_no, "amount_paise": order.total_paise},
    )
    db.commit()
    db.refresh(receipt)
    publish_kitchen_event(
        canteen_id=canteen_id,
        order_id=order.id,
        event_type="payment.confirmed",
        version=order.version,
    )
    return _receipt_payload(db, receipt), False


def reverse_cash(
    db: Session,
    *,
    manager: User,
    receipt_id: UUID,
    reason: str,
    kind: str,
    idempotency_key: str,
    clock: Clock = utcnow,
) -> tuple[dict, bool]:
    """Append a reversal and reopen the payment. Returns (receipt, replayed)."""

    canteen_id = manager_canteen_id(db, manager)
    preview = db.get(CashReceipt, receipt_id)
    if preview is None or preview.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Cash receipt not found.", status_code=404)
    order = lock_order(db, preview.order_id, canteen_id)
    payment = lock_payment(db, order)
    receipt = db.scalar(select(CashReceipt).where(CashReceipt.id == receipt_id).with_for_update())
    if receipt is None:
        raise ApiError(code="NOT_FOUND", message="Cash receipt not found.", status_code=404)

    existing = db.scalar(select(CashReversal).where(CashReversal.receipt_id == receipt.id))
    if existing is not None:
        return _receipt_payload(db, receipt), True
    if order.status == "PICKED_UP":
        raise ApiError(
            code="CONFLICT",
            message=(
                "This order was already collected. Cash cannot be reversed here. "
                "A refund process is outside this phase."
            ),
            status_code=409,
        )
    if order.status != "READY" or payment.status != "PAID":
        raise ApiError(
            code="CONFLICT",
            message="Only a paid, ready order can have its cash entry reversed.",
            status_code=409,
        )
    now = clock()
    db.add(
        CashReversal(
            receipt_id=receipt.id,
            order_id=order.id,
            canteen_id=canteen_id,
            amount_paise=receipt.amount_paise,
            manager_user_id=manager.id,
            kind=kind,
            reason=reason,
            idempotency_key=idempotency_key,
            reversed_at=now,
        )
    )
    payment.status = "PENDING"
    payment.paid_at = None
    payment.paid_by = None
    order.version += 1
    order.updated_at = now
    _event(db, order, manager.id, f"cash_reversed:{receipt_ref(receipt.receipt_no)}")
    audit(
        db,
        action="cash.reversed",
        actor_user_id=manager.id,
        target_type="cash_receipt",
        target_id=str(receipt.id),
        canteen_id=canteen_id,
        metadata={"kind": kind, "amount_paise": receipt.amount_paise, "order_id": str(order.id)},
    )
    db.commit()
    publish_kitchen_event(
        canteen_id=canteen_id,
        order_id=order.id,
        event_type="payment.reversed",
        version=order.version,
    )
    db.refresh(receipt)
    return _receipt_payload(db, receipt), False


def order_payload(
    db: Session,
    order: Order,
    *,
    payment: OrderPayment | None = None,
    include_student: bool = True,
) -> dict:
    """Minimum order view for the counter. No email, roll number, or session data."""

    payment = payment or db.scalar(select(OrderPayment).where(OrderPayment.order_id == order.id))
    if payment is None:
        raise ApiError(code="INTERNAL_ERROR", message="Order payment is missing.", status_code=500)
    items = list(
        db.scalars(
            select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.item_name)
        )
    )
    receipt = _effective_receipt(db, payment.id) if payment.status == "PAID" else None
    student = db.get(User, order.student_user_id) if include_student else None
    return {
        "id": order.id,
        "ticket_number": order.ticket_number,
        "status": order.status,
        "version": order.version,
        "total_paise": order.total_paise,
        "ready_at": order.ready_at,
        "picked_up_at": order.picked_up_at,
        "student_first_name": _first_name(student),
        "payment": {
            "method": payment.method,
            "status": payment.status,
            "amount_paise": payment.amount_paise,
            "paid_at": payment.paid_at,
            "receipt_ref": receipt_ref(receipt.receipt_no) if receipt else None,
        },
        "items": [{"item_name": line.item_name, "quantity": line.quantity} for line in items],
    }


def cashier_board(db: Session, *, cashier: User, limit: int) -> dict:
    canteen_id = cashier_canteen_id(db, cashier)
    now = utcnow()

    def ready_orders(payment_status: str) -> list[Order]:
        return list(
            db.scalars(
                select(Order)
                .join(OrderPayment, OrderPayment.order_id == Order.id)
                .where(
                    Order.canteen_id == canteen_id,
                    Order.status == "READY",
                    OrderPayment.status == payment_status,
                )
                .order_by(Order.ready_at.asc().nulls_last(), Order.ticket_number)
                .limit(limit)
            )
        )

    awaiting_payment = ready_orders("PENDING")
    awaiting_handover = ready_orders("PAID")
    overdue = list(
        db.scalars(
            select(Order)
            .where(Order.canteen_id == canteen_id, Order.status == "UNCLAIMED")
            .order_by(Order.unclaimed_at.asc().nulls_last(), Order.ticket_number)
            .limit(limit)
        )
    )
    completed = list(
        db.scalars(
            select(Order)
            .where(
                Order.canteen_id == canteen_id,
                Order.status == "PICKED_UP",
                Order.picked_up_at >= now - timedelta(hours=24),
            )
            .order_by(Order.picked_up_at.desc())
            .limit(limit)
        )
    )
    pending_total = db.scalar(
        select(func.coalesce(func.sum(Order.total_paise), 0))
        .join(OrderPayment, OrderPayment.order_id == Order.id)
        .where(
            Order.canteen_id == canteen_id,
            Order.status == "READY",
            OrderPayment.status == "PENDING",
        )
    )
    start = datetime.combine(now.date(), time.min, tzinfo=UTC)
    gross = db.scalar(
        select(func.coalesce(func.sum(CashReceipt.amount_paise), 0)).where(
            CashReceipt.canteen_id == canteen_id, CashReceipt.received_at >= start
        )
    )
    reversed_total = db.scalar(
        select(func.coalesce(func.sum(CashReversal.amount_paise), 0)).where(
            CashReversal.canteen_id == canteen_id, CashReversal.reversed_at >= start
        )
    )
    return {
        "awaiting_payment": [order_payload(db, order) for order in awaiting_payment],
        "awaiting_handover": [order_payload(db, order) for order in awaiting_handover],
        "overdue": [order_payload(db, order) for order in overdue],
        "completed": [order_payload(db, order) for order in completed],
        "totals": {
            "awaiting_payment_paise": int(pending_total or 0),
            "recorded_today_paise": int(gross or 0) - int(reversed_total or 0),
            "window_note": (
                "Recorded cash counts confirmed receipts minus reversals since 00:00 UTC. "
                "Orders awaiting payment are not cash."
            ),
        },
    }


def cashier_order(db: Session, *, cashier: User, order_id: UUID) -> dict:
    canteen_id = cashier_canteen_id(db, cashier)
    order = db.get(Order, order_id)
    if order is None or order.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    return order_payload(db, order)


def cashier_history(db: Session, *, cashier: User, limit: int, offset: int) -> dict:
    canteen_id = cashier_canteen_id(db, cashier)
    where = (CashReceipt.canteen_id == canteen_id, CashReceipt.cashier_user_id == cashier.id)
    total = db.scalar(select(func.count()).select_from(CashReceipt).where(*where)) or 0
    rows = list(
        db.scalars(
            select(CashReceipt)
            .where(*where)
            .order_by(CashReceipt.received_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return {
        "transactions": [_receipt_payload(db, row) for row in rows],
        "total": int(total),
        "limit": limit,
        "offset": offset,
    }


def _window(date_from: date | None, date_to: date | None) -> tuple[datetime, datetime]:
    today = utcnow().date()
    start_day = date_from or date_to or today
    end_day = date_to or date_from or today
    if end_day < start_day:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="The end date is before the start date.",
            status_code=422,
        )
    if (end_day - start_day).days > 366:
        raise ApiError(
            code="VALIDATION_ERROR", message="Choose a range of at most one year.", status_code=422
        )
    start = datetime.combine(start_day, time.min, tzinfo=UTC)
    end = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=UTC)
    return start, end


def cash_summary(
    db: Session, *, manager: User, date_from: date | None, date_to: date | None
) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    start, end = _window(date_from, date_to)
    gross_row = db.execute(
        select(func.count(), func.coalesce(func.sum(CashReceipt.amount_paise), 0)).where(
            CashReceipt.canteen_id == canteen_id,
            CashReceipt.received_at >= start,
            CashReceipt.received_at < end,
        )
    ).one()
    reversal_row = db.execute(
        select(func.count(), func.coalesce(func.sum(CashReversal.amount_paise), 0)).where(
            CashReversal.canteen_id == canteen_id,
            CashReversal.reversed_at >= start,
            CashReversal.reversed_at < end,
        )
    ).one()
    placed_row = db.execute(
        select(func.count(), func.coalesce(func.sum(Order.total_paise), 0)).where(
            Order.canteen_id == canteen_id,
            Order.created_at >= start,
            Order.created_at < end,
            Order.status.not_in(("CANCELLED", "REJECTED")),
        )
    ).one()
    paid_orders = db.scalar(
        select(func.count())
        .select_from(OrderPayment)
        .join(Order, Order.id == OrderPayment.order_id)
        .where(
            Order.canteen_id == canteen_id,
            OrderPayment.status == "PAID",
            OrderPayment.paid_at >= start,
            OrderPayment.paid_at < end,
        )
    )
    picked = db.execute(
        select(func.count(), func.coalesce(func.sum(Order.total_paise), 0)).where(
            Order.canteen_id == canteen_id,
            Order.status == "PICKED_UP",
            Order.picked_up_at >= start,
            Order.picked_up_at < end,
        )
    ).one()

    def pipeline(payment_status: str) -> tuple[int, int]:
        row = db.execute(
            select(func.count(), func.coalesce(func.sum(Order.total_paise), 0))
            .join(OrderPayment, OrderPayment.order_id == Order.id)
            .where(
                Order.canteen_id == canteen_id,
                Order.status == "READY",
                OrderPayment.status == payment_status,
            )
        ).one()
        return int(row[0]), int(row[1])

    waiting_payment = pipeline("PENDING")
    waiting_pickup = pipeline("PAID")
    gross_paise = int(gross_row[1])
    reversed_paise = int(reversal_row[1])
    return {
        "from_date": start.date(),
        "to_date": (end - timedelta(days=1)).date(),
        "timezone_note": "Dates are UTC calendar days. Totals are integer paise.",
        "orders_placed": int(placed_row[0]),
        "orders_placed_value_paise": int(placed_row[1]),
        "paid_orders": int(paid_orders or 0),
        "receipts_recorded": int(gross_row[0]),
        "gross_receipts_paise": gross_paise,
        "reversals_recorded": int(reversal_row[0]),
        "reversed_paise": reversed_paise,
        "net_cash_paise": gross_paise - reversed_paise,
        "ready_awaiting_payment": waiting_payment[0],
        "ready_awaiting_payment_paise": waiting_payment[1],
        "paid_awaiting_pickup": waiting_pickup[0],
        "paid_awaiting_pickup_paise": waiting_pickup[1],
        "picked_up_orders": int(picked[0]),
        "picked_up_value_paise": int(picked[1]),
        "notes": {
            "recorded": "Cash recorded is what cashiers confirmed. It is not a till count.",
            "pending": "Orders awaiting payment are not counted as cash.",
            "reconciliation": "No bank or physical till reconciliation is performed.",
        },
    }


def cash_transactions(
    db: Session,
    *,
    manager: User,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    start, end = _window(date_from, date_to)
    where = (
        CashReceipt.canteen_id == canteen_id,
        CashReceipt.received_at >= start,
        CashReceipt.received_at < end,
    )
    total = db.scalar(select(func.count()).select_from(CashReceipt).where(*where)) or 0
    rows = list(
        db.scalars(
            select(CashReceipt)
            .where(*where)
            .order_by(CashReceipt.received_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return {
        "transactions": [_receipt_payload(db, row) for row in rows],
        "total": int(total),
        "limit": limit,
        "offset": offset,
    }
