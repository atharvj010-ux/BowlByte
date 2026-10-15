"""In-app notifications and the transactional notification outbox.

`enqueue_order_ready` runs inside the same database transaction that moves the
order to READY. If that transaction rolls back, no notification exists. If the
transaction commits, the outbox row is durable even when Redis, Celery, or the
push service are down.
"""

import logging
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.fulfillment import Notification, NotificationOutbox
from app.models.identity import User
from app.models.ordering import Order
from app.services.realtime import publish_user_event

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]


def utcnow() -> datetime:
    return datetime.now(UTC)


def ready_copy(order: Order) -> tuple[str, str]:
    return (
        "BowlByte — Order Ready!",
        f"Your order #{order.ticket_number} is ready for pickup. "
        "Please pay cash at the canteen counter.",
    )


def enqueue_order_ready(db: Session, order: Order, now: datetime) -> UUID | None:
    """Insert the READY notification and its outbox row. Does not commit.

    The event key is unique per order and version, so a repeated READY transition
    can never create a second notification.
    """

    title, body = ready_copy(order)
    key = f"ORDER_READY:{order.id}:{order.version}"
    notification_id = db.scalar(
        pg_insert(Notification)
        .values(
            id=uuid4(),
            user_id=order.student_user_id,
            order_id=order.id,
            kind="ORDER_READY",
            title=title,
            body=body,
            dedupe_key=key,
            created_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_notifications_user_dedupe")
        .returning(Notification.id)
    )
    if notification_id is None:
        return None
    event_id = uuid4()
    db.execute(
        pg_insert(NotificationOutbox)
        .values(
            id=event_id,
            event_key=key,
            event_type="ORDER_READY",
            recipient_user_id=order.student_user_id,
            order_id=order.id,
            order_version=order.version,
            notification_id=notification_id,
            payload={
                "v": 1,
                "event_id": str(event_id),
                "type": "ORDER_READY",
                "order_id": str(order.id),
                "tag": f"order-{order.id}",
                "title": title,
                "body": body,
                "url": f"/student/orders/{order.id}",
            },
            status="PENDING",
            attempt_count=0,
            next_attempt_at=now,
            created_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_notification_outbox_event")
    )
    return notification_id


def enqueue_student_notice(
    db: Session,
    order: Order,
    now: datetime,
    *,
    kind: str,
    title: str,
    body: str,
) -> UUID | None:
    """One notice per order and kind. Does not commit and does not change payment."""

    key = f"{kind}:{order.id}"
    notification_id = db.scalar(
        pg_insert(Notification)
        .values(
            id=uuid4(),
            user_id=order.student_user_id,
            order_id=order.id,
            kind=kind,
            title=title,
            body=body[:300],
            dedupe_key=key,
            created_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_notifications_user_dedupe")
        .returning(Notification.id)
    )
    if notification_id is None:
        return None
    event_id = uuid4()
    db.execute(
        pg_insert(NotificationOutbox)
        .values(
            id=event_id,
            event_key=key,
            event_type=kind,
            recipient_user_id=order.student_user_id,
            order_id=order.id,
            order_version=order.version,
            notification_id=notification_id,
            payload={
                "v": 1,
                "event_id": str(event_id),
                "type": kind,
                "order_id": str(order.id),
                "tag": f"order-{order.id}",
                "title": title,
                "body": body[:300],
                "url": f"/student/orders/{order.id}",
            },
            status="PENDING",
            attempt_count=0,
            next_attempt_at=now,
            created_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_notification_outbox_event")
    )
    return notification_id


def after_ready_commit(order: Order) -> None:
    """Best-effort follow-ups after the READY commit. Failures never undo the transition."""

    publish_user_event(
        user_id=order.student_user_id,
        event_type="notification.created",
        resource_id=order.id,
        version=order.version,
    )
    kick_worker()


def kick_worker() -> None:
    """Ask Celery to drain the outbox now. The beat schedule is the safety net.

    Runs in a daemon thread so a slow or unavailable broker cannot delay the
    kitchen response.
    """

    def _send() -> None:
        try:
            from app.worker import celery_app

            celery_app.send_task("bowlbyte.drain_outbox", retry=False)
        except Exception as exc:  # broker down: beat or the next kick will pick it up
            logger.warning("outbox kick skipped: %s", type(exc).__name__)

    threading.Thread(target=_send, name="outbox-kick", daemon=True).start()


# --- Student-facing reads and writes ----------------------------------------------------


def _row(item: Notification) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "title": item.title,
        "body": item.body,
        "order_id": item.order_id,
        "created_at": item.created_at,
        "read_at": item.read_at,
        "read": item.read_at is not None,
    }


def unread_count(db: Session, user: User) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        or 0
    )


def list_notifications(
    db: Session, *, user: User, limit: int, offset: int, unread_only: bool
) -> dict:
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    rows = db.scalars(
        query.order_by(Notification.created_at.desc(), Notification.id).limit(limit).offset(offset)
    )
    return {"items": [_row(item) for item in rows], "unread_count": unread_count(db, user)}


def mark_read(db: Session, *, user: User, notification_id: UUID, clock: Clock = utcnow) -> dict:
    item = db.scalar(
        select(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user.id)
        .with_for_update()
    )
    if item is None:
        raise ApiError(code="NOT_FOUND", message="Notification not found.", status_code=404)
    if item.read_at is None:
        item.read_at = clock()
        db.commit()
    return {"notification": _row(item), "unread_count": unread_count(db, user)}


def mark_all_read(db: Session, *, user: User, clock: Clock = utcnow) -> dict:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=clock())
    )
    db.commit()
    return {"unread_count": unread_count(db, user)}


# --- Protected push test ---------------------------------------------------------------


def enqueue_test_push(db: Session, *, user: User, clock: Clock = utcnow) -> dict:
    """Queue a harmless test message to the caller's own devices (rate limited)."""

    settings = get_settings()
    if not settings.push_test_endpoint_enabled:
        raise ApiError(code="NOT_FOUND", message="Not found.", status_code=404)
    now = clock()
    recent = db.scalar(
        select(func.count())
        .select_from(NotificationOutbox)
        .where(
            NotificationOutbox.recipient_user_id == user.id,
            NotificationOutbox.event_type == "PUSH_TEST",
            NotificationOutbox.created_at
            > now - timedelta(seconds=settings.push_test_window_seconds),
        )
    )
    if int(recent or 0) >= settings.push_test_limit:
        raise ApiError(
            code="RATE_LIMITED",
            message="You sent too many test notifications. Wait a few minutes.",
            status_code=429,
        )
    event_id = uuid4()
    db.add(
        NotificationOutbox(
            id=event_id,
            event_key=f"PUSH_TEST:{event_id}",
            event_type="PUSH_TEST",
            recipient_user_id=user.id,
            payload={
                "v": 1,
                "event_id": str(event_id),
                "type": "PUSH_TEST",
                "tag": "bowlbyte-test",
                "title": "BowlByte — Test notification",
                "body": "Notifications are set up on this device.",
                "url": "/student/profile",
            },
            status="PENDING",
            next_attempt_at=now,
            created_at=now,
        )
    )
    db.commit()
    kick_worker()
    return {"event_id": event_id, "state": "QUEUED"}
