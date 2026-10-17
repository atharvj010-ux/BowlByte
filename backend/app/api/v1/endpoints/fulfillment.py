from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_principal
from app.core.errors import ApiError
from app.db.session import get_db
from app.schemas.fulfillment import (
    CashierBoardResponse,
    CashierHistoryResponse,
    CashSummaryResponse,
    CompletePickupRequest,
    CompletePickupResponse,
    ConfirmCashRequest,
    ConfirmCashResponse,
    CounterOrder,
    NotificationListResponse,
    NotificationReadResponse,
    PickupCredentialResponse,
    PickupStatusResponse,
    PickupVerifyRequest,
    PickupVerifyResponse,
    PushConfirmRequest,
    PushConfirmResponse,
    PushPublicKeyResponse,
    PushSubscribeRequest,
    PushSubscribeResponse,
    PushSubscriptionResponse,
    PushTestResponse,
    PushTestStatusResponse,
    PushUnsubscribeRequest,
    ReceiptResponse,
    ReverseCashRequest,
    ReverseCashResponse,
    UnreadResponse,
)
from app.services import cash, notifications, pickup, push, unclaimed
from app.services.identity import Principal
from app.services.push_delivery import outbox_metrics
from app.services.rate_limit import consume_allowance

router = APIRouter(tags=["cash-pickup-notifications"])


def _role(principal: Principal, role: str) -> Principal:
    if principal.user.role != role:
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    return principal


def _cashier(principal: Principal = Depends(require_principal)) -> Principal:
    return _role(principal, "CASHIER")


def _cashier_write(principal: Principal = Depends(require_csrf)) -> Principal:
    return _role(principal, "CASHIER")


def _student(principal: Principal = Depends(require_principal)) -> Principal:
    return _role(principal, "STUDENT")


def _student_write(principal: Principal = Depends(require_csrf)) -> Principal:
    return _role(principal, "STUDENT")


def _manager(principal: Principal = Depends(require_principal)) -> Principal:
    return _role(principal, "CANTEEN_MANAGER")


def _manager_write(principal: Principal = Depends(require_csrf)) -> Principal:
    return _role(principal, "CANTEEN_MANAGER")


# --- Cashier ------------------------------------------------------------------------------


@router.get("/cashier/orders", response_model=CashierBoardResponse)
def cashier_orders(
    limit: int = Query(default=50, ge=1, le=100),
    principal: Principal = Depends(_cashier),
    db: Session = Depends(get_db),
) -> CashierBoardResponse:
    return CashierBoardResponse.model_validate(
        cash.cashier_board(db, cashier=principal.user, limit=limit)
    )


@router.get("/cashier/orders/{order_id}", response_model=CounterOrder)
def cashier_order(
    order_id: UUID,
    principal: Principal = Depends(_cashier),
    db: Session = Depends(get_db),
) -> CounterOrder:
    return CounterOrder.model_validate(
        cash.cashier_order(db, cashier=principal.user, order_id=order_id)
    )


@router.get("/cashier/history", response_model=CashierHistoryResponse)
def cashier_history(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000),
    principal: Principal = Depends(_cashier),
    db: Session = Depends(get_db),
) -> CashierHistoryResponse:
    return CashierHistoryResponse.model_validate(
        cash.cashier_history(db, cashier=principal.user, limit=limit, offset=offset)
    )


@router.post("/cashier/pickup/verify", response_model=PickupVerifyResponse)
def verify_pickup(
    payload: PickupVerifyRequest,
    principal: Principal = Depends(_cashier_write),
    db: Session = Depends(get_db),
) -> PickupVerifyResponse:
    return PickupVerifyResponse.model_validate(
        pickup.verify_credential(
            db,
            cashier=principal.user,
            token=payload.token,
            ticket_number=payload.ticket_number,
            code=payload.code,
        )
    )


@router.post("/cashier/orders/{order_id}/confirm-cash", response_model=ConfirmCashResponse)
def confirm_cash(
    order_id: UUID,
    payload: ConfirmCashRequest,
    principal: Principal = Depends(_cashier_write),
    db: Session = Depends(get_db),
) -> ConfirmCashResponse:
    consume_allowance(
        bucket="cash-user",
        value=str(principal.user.id),
        limit=40,
        window_seconds=10 * 60,
        unavailable_message="Cash confirmation is temporarily unavailable.",
        limited_message="Too many cash confirmations. Wait and try again.",
    )
    receipt, replayed = cash.confirm_cash(
        db,
        cashier=principal.user,
        order_id=order_id,
        acknowledged_amount_paise=payload.amount_paise,
        idempotency_key=payload.idempotency_key,
    )
    return ConfirmCashResponse(
        receipt=ReceiptResponse.model_validate(receipt),
        order=CounterOrder.model_validate(
            cash.cashier_order(db, cashier=principal.user, order_id=order_id)
        ),
        replayed=replayed,
    )


@router.post("/cashier/orders/{order_id}/complete-pickup", response_model=CompletePickupResponse)
def complete_pickup(
    order_id: UUID,
    payload: CompletePickupRequest,
    principal: Principal = Depends(_cashier_write),
    db: Session = Depends(get_db),
) -> CompletePickupResponse:
    consume_allowance(
        bucket="pickup-complete",
        value=str(principal.user.id),
        limit=30,
        window_seconds=10 * 60,
        unavailable_message="Pickup is temporarily unavailable.",
        limited_message="Too many pickup attempts. Wait and try again.",
    )
    order, replayed = pickup.complete_pickup(
        db,
        cashier=principal.user,
        order_id=order_id,
        token=payload.token,
        code=payload.code,
        idempotency_key=payload.idempotency_key,
    )
    return CompletePickupResponse(order=CounterOrder.model_validate(order), replayed=replayed)


# --- Student pickup credential --------------------------------------------------------------


@router.post("/orders/{order_id}/pickup-credential", response_model=PickupCredentialResponse)
def issue_pickup_credential(
    order_id: UUID,
    principal: Principal = Depends(_student_write),
    db: Session = Depends(get_db),
) -> PickupCredentialResponse:
    return PickupCredentialResponse.model_validate(
        pickup.issue_credential(db, student=principal.user, order_id=order_id)
    )


@router.get("/orders/{order_id}/pickup-status", response_model=PickupStatusResponse)
def pickup_status(
    order_id: UUID,
    principal: Principal = Depends(_student),
    db: Session = Depends(get_db),
) -> PickupStatusResponse:
    return PickupStatusResponse.model_validate(
        pickup.pickup_status(db, student=principal.user, order_id=order_id)
    )


# --- Web Push -----------------------------------------------------------------------------


@router.get("/push/public-key", response_model=PushPublicKeyResponse)
def push_public_key(_: Principal = Depends(_student)) -> PushPublicKeyResponse:
    return PushPublicKeyResponse.model_validate(push.public_key_info())


@router.get("/push/subscriptions", response_model=list[PushSubscriptionResponse])
def push_subscriptions(
    principal: Principal = Depends(_student), db: Session = Depends(get_db)
) -> list[PushSubscriptionResponse]:
    return [
        PushSubscriptionResponse.model_validate(row)
        for row in push.list_my_subscriptions(db, user=principal.user)
    ]


@router.post("/push/subscriptions", response_model=PushSubscribeResponse, status_code=201)
def push_subscribe(
    payload: PushSubscribeRequest,
    response: Response,
    principal: Principal = Depends(_student_write),
    db: Session = Depends(get_db),
) -> PushSubscribeResponse:
    expiration = (
        datetime.fromtimestamp(payload.expiration_time / 1000, tz=UTC)
        if payload.expiration_time
        else None
    )
    row, created = push.register_subscription(
        db,
        user=principal.user,
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        expiration_time=expiration,
        device_label=payload.device_label,
    )
    if not created:
        response.status_code = 200
    return PushSubscribeResponse(
        subscription=PushSubscriptionResponse.model_validate(
            {
                "id": row.id,
                "device_label": row.device_label,
                "enabled": row.enabled,
                "disabled_reason": row.disabled_reason,
                "created_at": row.created_at,
                "last_success_at": row.last_success_at,
                "last_attempt_at": row.last_attempt_at,
            }
        ),
        created=created,
    )


@router.post("/push/subscriptions/confirm", response_model=PushConfirmResponse)
def push_confirm(
    payload: PushConfirmRequest,
    principal: Principal = Depends(_student_write),
    db: Session = Depends(get_db),
) -> PushConfirmResponse:
    return PushConfirmResponse(
        active=push.subscription_active(db, user=principal.user, endpoint=payload.endpoint)
    )


@router.delete("/push/subscriptions", status_code=204)
def push_unsubscribe(
    payload: PushUnsubscribeRequest,
    principal: Principal = Depends(_student_write),
    db: Session = Depends(get_db),
) -> Response:
    push.unregister_subscription(db, user=principal.user, endpoint=payload.endpoint)
    return Response(status_code=204)


@router.post("/push/test", response_model=PushTestResponse, status_code=202)
def push_test(
    principal: Principal = Depends(_student_write), db: Session = Depends(get_db)
) -> PushTestResponse:
    consume_allowance(
        bucket="push-test",
        value=str(principal.user.id),
        limit=3,
        window_seconds=60 * 60,
        unavailable_message="Test notifications are temporarily unavailable.",
        limited_message="Too many test notifications. Wait and try again.",
    )
    return PushTestResponse.model_validate(notifications.enqueue_test_push(db, user=principal.user))


@router.get("/push/test/{event_id}", response_model=PushTestStatusResponse)
def push_test_status(
    event_id: UUID,
    principal: Principal = Depends(_student),
    db: Session = Depends(get_db),
) -> PushTestStatusResponse:
    return PushTestStatusResponse.model_validate(
        notifications.test_event_status(db, user=principal.user, event_id=event_id)
    )


# --- In-app notifications -----------------------------------------------------------------


@router.get("/notifications", response_model=NotificationListResponse)
def list_notifications(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000),
    unread_only: bool = False,
    principal: Principal = Depends(_student),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    return NotificationListResponse.model_validate(
        notifications.list_notifications(
            db, user=principal.user, limit=limit, offset=offset, unread_only=unread_only
        )
    )


@router.get("/notifications/unread-count", response_model=UnreadResponse)
def unread_count(
    principal: Principal = Depends(_student), db: Session = Depends(get_db)
) -> UnreadResponse:
    return UnreadResponse(unread_count=notifications.unread_count(db, principal.user))


@router.post("/notifications/read-all", response_model=UnreadResponse)
def read_all(
    principal: Principal = Depends(_student_write), db: Session = Depends(get_db)
) -> UnreadResponse:
    return UnreadResponse.model_validate(notifications.mark_all_read(db, user=principal.user))


@router.post("/notifications/{notification_id}/read", response_model=NotificationReadResponse)
def read_notification(
    notification_id: UUID,
    principal: Principal = Depends(_student_write),
    db: Session = Depends(get_db),
) -> NotificationReadResponse:
    return NotificationReadResponse.model_validate(
        notifications.mark_read(db, user=principal.user, notification_id=notification_id)
    )


# --- Manager cash ------------------------------------------------------------------------------


@router.get("/admin/cash/summary", response_model=CashSummaryResponse)
def cash_summary(
    date_from: date | None = None,
    date_to: date | None = None,
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> CashSummaryResponse:
    return CashSummaryResponse.model_validate(
        cash.cash_summary(db, manager=principal.user, date_from=date_from, date_to=date_to)
    )


@router.get("/admin/cash/transactions", response_model=CashierHistoryResponse)
def cash_transactions(
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000),
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> CashierHistoryResponse:
    return CashierHistoryResponse.model_validate(
        cash.cash_transactions(
            db,
            manager=principal.user,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
            offset=offset,
        )
    )


@router.post("/admin/cash/{receipt_id}/reverse", response_model=ReverseCashResponse)
def reverse_cash(
    receipt_id: UUID,
    payload: ReverseCashRequest,
    principal: Principal = Depends(_manager_write),
    db: Session = Depends(get_db),
) -> ReverseCashResponse:
    receipt, replayed = cash.reverse_cash(
        db,
        manager=principal.user,
        receipt_id=receipt_id,
        reason=payload.reason,
        kind=payload.kind,
        idempotency_key=payload.idempotency_key,
    )
    return ReverseCashResponse(receipt=ReceiptResponse.model_validate(receipt), replayed=replayed)


@router.get("/admin/push/metrics")
def push_metrics(_: Principal = Depends(_manager), db: Session = Depends(get_db)) -> dict:
    return outbox_metrics(db)


@router.get("/admin/orders/unclaimed")
def unclaimed_orders(
    limit: int = Query(default=50, ge=1, le=100),
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    return {"orders": unclaimed.list_unclaimed(db, manager=principal.user, limit=limit)}


@router.post("/admin/orders/{order_id}/hold/extend")
def extend_pickup_hold(
    order_id: UUID,
    payload: dict,
    principal: Principal = Depends(_manager_write),
    db: Session = Depends(get_db),
) -> dict:
    minutes = int(payload.get("minutes", 30))
    note = str(payload.get("note", ""))
    return unclaimed.extend_hold(
        db,
        manager=principal.user,
        order_id=order_id,
        minutes=minutes,
        note=note,
        now=datetime.now(UTC),
    )


@router.post("/admin/orders/{order_id}/hold/review")
def review_pickup_hold(
    order_id: UUID,
    payload: dict,
    principal: Principal = Depends(_manager_write),
    db: Session = Depends(get_db),
) -> dict:
    return unclaimed.review_hold(
        db,
        manager=principal.user,
        order_id=order_id,
        note=str(payload.get("note", "")),
        now=datetime.now(UTC),
    )


@router.put("/admin/canteen/pickup-hold")
def set_pickup_hold(
    payload: dict,
    principal: Principal = Depends(_manager_write),
    db: Session = Depends(get_db),
) -> dict:
    return unclaimed.update_hold_policy(
        db, manager=principal.user, minutes=int(payload.get("minutes", 30))
    )
