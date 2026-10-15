"""Cash receipts, pickup credentials, and notification tables (P005).

Cash receipts and reversals are append-only. The payment row holds the current
effective state, and the ledger tables hold the history behind it.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.identity import _uuid

PICKUP_EVENT_TYPES = (
    "ISSUED",
    "VERIFIED",
    "VERIFY_REJECTED",
    "REDEEMED",
    "REDEEM_REJECTED",
    "REVOKED",
)
REVERSAL_KINDS = ("CASH_RETURNED", "ERRONEOUS_ENTRY")
OUTBOX_STATUSES = ("PENDING", "DONE")
DELIVERY_STATUSES = ("PENDING", "ACCEPTED", "REJECTED", "GONE", "FAILED", "SKIPPED")


class CashReceipt(Base):
    __tablename__ = "cash_receipts"
    __table_args__ = (
        UniqueConstraint("payment_id", "attempt_no", name="uq_cash_receipts_payment_attempt"),
        UniqueConstraint("payment_id", "idempotency_key", name="uq_cash_receipts_payment_key"),
        UniqueConstraint("receipt_no", name="uq_cash_receipts_receipt_no"),
        CheckConstraint("amount_paise >= 0", name="ck_cash_receipts_amount"),
        CheckConstraint("attempt_no >= 1", name="ck_cash_receipts_attempt"),
        Index("ix_cash_receipts_canteen_received", "canteen_id", "received_at"),
        Index("ix_cash_receipts_order", "order_id"),
        Index("ix_cash_receipts_cashier", "cashier_user_id", "received_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    # Allocated from the cash_receipt_no_seq sequence inside the confirming transaction.
    receipt_no: Mapped[int] = mapped_column(BigInteger, nullable=False)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False
    )
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order_payments.id"), nullable=False
    )
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    cashier_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    ticket_number: Mapped[str] = mapped_column(String(16), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class CashReversal(Base):
    __tablename__ = "cash_reversals"
    __table_args__ = (
        UniqueConstraint("receipt_id", name="uq_cash_reversals_receipt"),
        CheckConstraint(
            "kind in ('CASH_RETURNED', 'ERRONEOUS_ENTRY')", name="ck_cash_reversals_kind"
        ),
        CheckConstraint("amount_paise >= 0", name="ck_cash_reversals_amount"),
        CheckConstraint("char_length(reason) between 5 and 300", name="ck_cash_reversals_reason"),
        Index("ix_cash_reversals_canteen_reversed", "canteen_id", "reversed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    receipt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cash_receipts.id"), nullable=False
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False
    )
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    manager_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    reversed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PickupCredential(Base):
    __tablename__ = "pickup_credentials"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_pickup_credentials_token"),
        Index(
            "uq_pickup_credentials_one_active",
            "order_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL AND redeemed_at IS NULL"),
        ),
        Index("ix_pickup_credentials_order", "order_id", "created_at"),
        CheckConstraint("expires_at > created_at", name="ck_pickup_credentials_expiry"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False
    )
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    student_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(40))
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    redeemed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    redeem_idempotency_key: Mapped[str | None] = mapped_column(String(80))


class PickupEvent(Base):
    __tablename__ = "pickup_events"
    __table_args__ = (
        CheckConstraint(
            "event_type in ('ISSUED', 'VERIFIED', 'VERIFY_REJECTED', 'REDEEMED', "
            "'REDEEM_REJECTED', 'REVOKED')",
            name="ck_pickup_events_type",
        ),
        Index("ix_pickup_events_order", "order_id", "created_at"),
        Index("ix_pickup_events_canteen", "canteen_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    canteen_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id")
    )
    credential_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pickup_credentials.id")
    )
    event_type: Mapped[str] = mapped_column(String(24), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    outcome: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (
        UniqueConstraint("endpoint_hash", name="uq_push_subscriptions_endpoint"),
        Index("ix_push_subscriptions_user", "user_id", "enabled"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Fernet ciphertext. The plaintext endpoint and keys never reach logs or API responses.
    endpoint_enc: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh_enc: Mapped[str] = mapped_column(Text, nullable=False)
    auth_enc: Mapped[str] = mapped_column(Text, nullable=False)
    device_label: Mapped[str | None] = mapped_column(String(60))
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    disabled_reason: Mapped[str | None] = mapped_column(String(40))
    expiration_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status_code: Mapped[int | None] = mapped_column(Integer)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_dedupe"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(String(300), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        UniqueConstraint("event_key", name="uq_notification_outbox_event"),
        CheckConstraint("status in ('PENDING', 'DONE')", name="ck_notification_outbox_status"),
        Index("ix_notification_outbox_due", "status", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    event_key: Mapped[str] = mapped_column(String(120), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    order_version: Mapped[int | None] = mapped_column(Integer)
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notifications.id")
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    result: Mapped[str | None] = mapped_column(String(32))
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PushDelivery(Base):
    __tablename__ = "push_deliveries"
    __table_args__ = (
        UniqueConstraint("outbox_id", "subscription_id", name="uq_push_deliveries_event_device"),
        CheckConstraint(
            "status in ('PENDING', 'ACCEPTED', 'REJECTED', 'GONE', 'FAILED', 'SKIPPED')",
            name="ck_push_deliveries_status",
        ),
        Index("ix_push_deliveries_due", "status", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    outbox_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notification_outbox.id", ondelete="CASCADE"), nullable=False
    )
    subscription_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("push_subscriptions.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    response_status: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    transport: Mapped[str | None] = mapped_column(String(16))
    error_code: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
