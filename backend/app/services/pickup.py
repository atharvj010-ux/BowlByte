"""Pickup credentials: issue, verify, and redeem exactly once.

A credential is a high-entropy opaque token (QR payload) plus a separate
high-entropy human-readable code for manual entry. Only keyed hashes are
stored. Verification is read-only. Redemption re-checks every rule inside one
PostgreSQL transaction and is the only place an order becomes PICKED_UP.
"""

import hashlib
import hmac
import logging
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.fulfillment import PickupCredential, PickupEvent
from app.models.identity import User
from app.models.ordering import Order, OrderEvent, OrderPayment
from app.services.cash import lock_order, lock_payment, order_payload
from app.services.identity import _audit as audit
from app.services.ordering import cashier_canteen_id
from app.services.rate_limit import assert_allowance, record_attempt
from app.services.realtime import publish_kitchen_event

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]

TOKEN_PREFIX = "bbp1."
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 12
_CROCKFORD_FIX = str.maketrans({"O": "0", "I": "1", "L": "1", "U": "V"})
INVALID = "That pickup code is not valid."


def utcnow() -> datetime:
    return datetime.now(UTC)


def keyed_hash(value: str) -> str:
    key = get_settings().pickup_hash_key.encode("utf-8")
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def new_code() -> str:
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    return "-".join(raw[index : index + 4] for index in range(0, CODE_LENGTH, 4))


def normalize_code(code: str) -> str | None:
    cleaned = "".join(char for char in code.upper() if char not in " -").translate(_CROCKFORD_FIX)
    if len(cleaned) != CODE_LENGTH or any(char not in CODE_ALPHABET for char in cleaned):
        return None
    return cleaned


def _normalize_token(token: str) -> str | None:
    cleaned = token.strip()
    if not cleaned.startswith(TOKEN_PREFIX) or len(cleaned) > 128:
        return None
    return cleaned


def _event_row(
    db: Session,
    *,
    event_type: str,
    actor_id: UUID | None,
    order: Order | None = None,
    credential: PickupCredential | None = None,
    canteen_id: UUID | None = None,
    outcome: str | None = None,
) -> None:
    db.add(
        PickupEvent(
            order_id=order.id if order else None,
            canteen_id=canteen_id or (order.canteen_id if order else None),
            credential_id=credential.id if credential else None,
            event_type=event_type,
            actor_user_id=actor_id,
            outcome=outcome,
        )
    )


# --- Student side -----------------------------------------------------------------------


def issue_credential(db: Session, *, student: User, order_id: UUID, clock: Clock = utcnow) -> dict:
    settings = get_settings()
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.student_user_id == student.id)
        .with_for_update()
    )
    if order is None:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    if order.status == "PICKED_UP":
        raise ApiError(
            code="CONFLICT", message="This order has already been collected.", status_code=409
        )
    if order.status != "READY":
        raise ApiError(
            code="ORDER_NOT_READY",
            message="Your pickup code is available once the kitchen marks the order ready.",
            status_code=409,
        )
    now = clock()
    recent = db.scalar(
        select(func.count())
        .select_from(PickupCredential)
        .where(
            PickupCredential.order_id == order.id,
            PickupCredential.created_at
            > now - timedelta(seconds=settings.pickup_issue_window_seconds),
        )
    )
    if int(recent or 0) >= settings.pickup_issue_limit:
        raise ApiError(
            code="RATE_LIMITED",
            message="You asked for too many pickup codes. Wait a few minutes.",
            status_code=429,
        )
    replaced = list(
        db.scalars(
            select(PickupCredential)
            .where(
                PickupCredential.order_id == order.id,
                PickupCredential.revoked_at.is_(None),
                PickupCredential.redeemed_at.is_(None),
            )
            .with_for_update()
        )
    )
    for old in replaced:
        old.revoked_at = now
        old.revoked_reason = "replaced"
        _event_row(
            db,
            event_type="REVOKED",
            actor_id=student.id,
            order=order,
            credential=old,
            outcome="replaced",
        )
    db.flush()
    token = new_token()
    code = new_code()
    credential = PickupCredential(
        order_id=order.id,
        canteen_id=order.canteen_id,
        student_user_id=student.id,
        token_hash=keyed_hash(token),
        code_hash=keyed_hash(normalize_code(code) or ""),
        created_at=now,
        expires_at=now + timedelta(seconds=settings.pickup_credential_ttl_seconds),
    )
    db.add(credential)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent issue lost the active-credential race
        db.rollback()
        raise ApiError(code="CONFLICT", message="Try again in a moment.", status_code=409) from exc
    _event_row(
        db,
        event_type="ISSUED",
        actor_id=student.id,
        order=order,
        credential=credential,
        outcome="rotated" if replaced else "new",
    )
    db.commit()
    db.refresh(credential)
    # The raw token and code exist only in this response.
    return {
        "credential_id": credential.id,
        "order_id": order.id,
        "ticket_number": order.ticket_number,
        "token": token,
        "code": code,
        "issued_at": credential.created_at,
        "expires_at": credential.expires_at,
        "replaced_previous": bool(replaced),
    }


def pickup_status(db: Session, *, student: User, order_id: UUID, clock: Clock = utcnow) -> dict:
    order = db.scalar(
        select(Order).where(Order.id == order_id, Order.student_user_id == student.id)
    )
    if order is None:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    payment = db.scalar(select(OrderPayment).where(OrderPayment.order_id == order.id))
    now = clock()
    active = db.scalar(
        select(PickupCredential)
        .where(
            PickupCredential.order_id == order.id,
            PickupCredential.revoked_at.is_(None),
            PickupCredential.redeemed_at.is_(None),
        )
        .order_by(PickupCredential.created_at.desc())
        .limit(1)
    )
    if order.status == "PICKED_UP":
        state = "COLLECTED"
    elif order.status != "READY":
        state = "NOT_READY"
    elif active is None:
        state = "AVAILABLE"
    elif active.expires_at <= now:
        state = "EXPIRED"
    else:
        state = "ACTIVE"
    return {
        "order_id": order.id,
        "order_status": order.status,
        "state": state,
        "can_request": order.status == "READY",
        "credential_expires_at": active.expires_at if active and order.status == "READY" else None,
        "payment_status": payment.status if payment else "PENDING",
        "paid_at": payment.paid_at if payment else None,
        "picked_up_at": order.picked_up_at,
    }


# --- Cashier side -----------------------------------------------------------------------


def _reject(
    db: Session,
    *,
    event_type: str,
    actor_id: UUID,
    canteen_id: UUID,
    outcome: str,
    status_code: int,
    message: str,
    code: str,
    order: Order | None = None,
    credential: PickupCredential | None = None,
) -> ApiError:
    _event_row(
        db,
        event_type=event_type,
        actor_id=actor_id,
        order=order,
        credential=credential,
        canteen_id=canteen_id,
        outcome=outcome,
    )
    db.commit()
    return ApiError(code=code, message=message, status_code=status_code)


def _throttle(cashier: User, ticket: str | None) -> None:
    settings = get_settings()
    assert_allowance(
        bucket="pickup-cashier",
        value=str(cashier.id),
        limit=settings.pickup_verify_failure_limit,
        unavailable_message="Pickup checks are temporarily unavailable.",
    )
    if ticket:
        assert_allowance(
            bucket="pickup-ticket",
            value=ticket.upper(),
            limit=settings.pickup_ticket_failure_limit,
            unavailable_message="Pickup checks are temporarily unavailable.",
        )


def _record_failure(cashier: User, ticket: str | None) -> None:
    settings = get_settings()
    record_attempt(
        bucket="pickup-cashier",
        value=str(cashier.id),
        window_seconds=settings.pickup_failure_window_seconds,
        unavailable_message="Pickup checks are temporarily unavailable.",
    )
    if ticket:
        record_attempt(
            bucket="pickup-ticket",
            value=ticket.upper(),
            window_seconds=settings.pickup_failure_window_seconds,
            unavailable_message="Pickup checks are temporarily unavailable.",
        )


def _find_credential(
    db: Session,
    *,
    canteen_id: UUID,
    token: str | None,
    ticket_number: str | None,
    code: str | None,
    order_id: UUID | None = None,
    lock: bool = False,
) -> tuple[PickupCredential | None, Order | None]:
    """Resolve a credential from a QR token or from ticket plus manual code.

    Returns (credential, order). A match in another canteen is treated as no match.
    """

    credential: PickupCredential | None = None
    if token:
        cleaned = _normalize_token(token)
        if cleaned is None:
            return None, None
        query = select(PickupCredential).where(PickupCredential.token_hash == keyed_hash(cleaned))
    elif ticket_number and code:
        normalized = normalize_code(code)
        if normalized is None:
            return None, None
        target = db.scalar(
            select(Order).where(
                Order.ticket_number == ticket_number.strip().upper(), Order.canteen_id == canteen_id
            )
        )
        if target is None:
            return None, None
        query = (
            select(PickupCredential)
            .where(
                PickupCredential.order_id == target.id,
                PickupCredential.code_hash == keyed_hash(normalized),
            )
            .order_by(PickupCredential.created_at.desc())
            .limit(1)
        )
    else:
        return None, None
    if lock:
        query = query.with_for_update()
    credential = db.scalar(query)
    if credential is None or credential.canteen_id != canteen_id:
        return None, None
    if order_id is not None and credential.order_id != order_id:
        return None, None
    order = db.get(Order, credential.order_id)
    return credential, order


def verify_credential(
    db: Session,
    *,
    cashier: User,
    token: str | None,
    ticket_number: str | None,
    code: str | None,
    clock: Clock = utcnow,
) -> dict:
    """Read-only check. It never marks cash received and never consumes the credential."""

    canteen_id = cashier_canteen_id(db, cashier)
    _throttle(cashier, ticket_number if code else None)
    credential, order = _find_credential(
        db, canteen_id=canteen_id, token=token, ticket_number=ticket_number, code=code
    )
    if credential is None or order is None:
        _record_failure(cashier, ticket_number if code else None)
        raise _reject(
            db,
            event_type="VERIFY_REJECTED",
            actor_id=cashier.id,
            canteen_id=canteen_id,
            outcome="unknown",
            status_code=404,
            code="PICKUP_INVALID",
            message=INVALID,
        )
    now = clock()
    problem = _credential_problem(credential, order, now)
    if problem is not None:
        outcome, status_code, message = problem
        _record_failure(cashier, ticket_number if code else None)
        raise _reject(
            db,
            event_type="VERIFY_REJECTED",
            actor_id=cashier.id,
            canteen_id=canteen_id,
            outcome=outcome,
            status_code=status_code,
            code=f"PICKUP_{outcome.upper()}",
            message=message,
            order=order,
            credential=credential,
        )
    _event_row(
        db,
        event_type="VERIFIED",
        actor_id=cashier.id,
        order=order,
        credential=credential,
        outcome="ok",
    )
    db.commit()
    payload = order_payload(db, order)
    paid = payload["payment"]["status"] == "PAID"
    return {
        "order": payload,
        "credential_id": credential.id,
        "credential_expires_at": credential.expires_at,
        "can_confirm_cash": not paid,
        "can_complete_pickup": paid,
    }


def _credential_problem(
    credential: PickupCredential, order: Order, now: datetime
) -> tuple[str, int, str] | None:
    if credential.redeemed_at is not None:
        return ("used", 409, "This pickup code was already used.")
    if credential.revoked_at is not None:
        return (
            "revoked",
            409,
            "This pickup code was replaced. Ask the student to show the new one.",
        )
    if credential.expires_at <= now:
        return ("expired", 410, "This pickup code expired. Ask the student to refresh it.")
    if order.status == "PICKED_UP":
        return ("used", 409, "This order has already been collected.")
    if order.status != "READY":
        return ("not_ready", 409, "This order is not ready for collection.")
    return None


def complete_pickup(
    db: Session,
    *,
    cashier: User,
    order_id: UUID,
    token: str | None,
    code: str | None,
    idempotency_key: str,
    clock: Clock = utcnow,
) -> tuple[dict, bool]:
    """READY + PAID + valid credential -> PICKED_UP, exactly once."""

    canteen_id = cashier_canteen_id(db, cashier)
    _throttle(cashier, str(order_id) if code else None)
    order = lock_order(db, order_id, canteen_id)
    payment = lock_payment(db, order)
    credential, _ = _find_credential(
        db,
        canteen_id=canteen_id,
        token=token,
        ticket_number=order.ticket_number if code else None,
        code=code,
        order_id=order.id,
        lock=True,
    )
    if credential is None:
        _record_failure(cashier, str(order_id) if code else None)
        raise _reject(
            db,
            event_type="REDEEM_REJECTED",
            actor_id=cashier.id,
            canteen_id=canteen_id,
            outcome="unknown",
            status_code=404,
            code="PICKUP_INVALID",
            message=INVALID,
            order=order,
        )
    if (
        credential.redeemed_at is not None
        and credential.redeemed_by == cashier.id
        and credential.redeem_idempotency_key == idempotency_key
    ):
        return order_payload(db, order, payment=payment), True
    now = clock()
    problem = _credential_problem(credential, order, now)
    if problem is not None:
        outcome, status_code, message = problem
        raise _reject(
            db,
            event_type="REDEEM_REJECTED",
            actor_id=cashier.id,
            canteen_id=canteen_id,
            outcome=outcome,
            status_code=status_code,
            code=f"PICKUP_{outcome.upper()}",
            message=message,
            order=order,
            credential=credential,
        )
    if payment.status != "PAID":
        raise _reject(
            db,
            event_type="REDEEM_REJECTED",
            actor_id=cashier.id,
            canteen_id=canteen_id,
            outcome="payment_pending",
            status_code=409,
            code="PAYMENT_PENDING",
            message=(
                "Cash has not been recorded. Confirm cash received before handing over the order."
            ),
            order=order,
            credential=credential,
        )
    credential.redeemed_at = now
    credential.redeemed_by = cashier.id
    credential.redeem_idempotency_key = idempotency_key
    previous = order.status
    order.status = "PICKED_UP"
    order.picked_up_at = now
    order.picked_up_by = cashier.id
    order.version += 1
    order.updated_at = now
    db.add(
        OrderEvent(
            order_id=order.id,
            from_status=previous,
            to_status="PICKED_UP",
            actor_user_id=cashier.id,
            reason="pickup",
        )
    )
    _event_row(
        db,
        event_type="REDEEMED",
        actor_id=cashier.id,
        order=order,
        credential=credential,
        outcome="ok",
    )
    audit(
        db,
        action="pickup.completed",
        actor_user_id=cashier.id,
        target_type="order",
        target_id=str(order.id),
        canteen_id=canteen_id,
        metadata={"credential_id": str(credential.id)},
    )
    db.commit()
    publish_kitchen_event(
        canteen_id=canteen_id,
        order_id=order.id,
        event_type="order.picked_up",
        version=order.version,
    )
    return order_payload(db, order, payment=payment), False
