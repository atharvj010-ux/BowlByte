"""Cash receipts, pickup credentials, push subscriptions, and the notification outbox."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_cash_pickup_notifications"
down_revision: str | None = "0004_kitchen_queue"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def _id() -> sa.Column:
    return sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.add_column("orders", sa.Column("picked_up_at", TS, nullable=True))
    op.add_column(
        "orders", sa.Column("picked_up_by", UUID, sa.ForeignKey("users.id"), nullable=True)
    )
    op.add_column("order_payments", sa.Column("paid_at", TS, nullable=True))
    op.add_column(
        "order_payments", sa.Column("paid_by", UUID, sa.ForeignKey("users.id"), nullable=True)
    )

    op.execute("CREATE SEQUENCE cash_receipt_no_seq START 1")
    op.create_table(
        "cash_receipts",
        _id(),
        sa.Column("receipt_no", sa.BigInteger(), nullable=False),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("payment_id", UUID, sa.ForeignKey("order_payments.id"), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("cashier_user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("received_at", TS, nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        sa.Column("ticket_number", sa.String(16), nullable=False),
        sa.Column(
            "metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("payment_id", "attempt_no", name="uq_cash_receipts_payment_attempt"),
        sa.UniqueConstraint("payment_id", "idempotency_key", name="uq_cash_receipts_payment_key"),
        sa.UniqueConstraint("receipt_no", name="uq_cash_receipts_receipt_no"),
        sa.CheckConstraint("amount_paise >= 0", name="ck_cash_receipts_amount"),
        sa.CheckConstraint("attempt_no >= 1", name="ck_cash_receipts_attempt"),
    )
    op.create_index(
        "ix_cash_receipts_canteen_received", "cash_receipts", ["canteen_id", "received_at"]
    )
    op.create_index("ix_cash_receipts_order", "cash_receipts", ["order_id"])
    op.create_index("ix_cash_receipts_cashier", "cash_receipts", ["cashier_user_id", "received_at"])

    op.create_table(
        "cash_reversals",
        _id(),
        sa.Column("receipt_id", UUID, sa.ForeignKey("cash_receipts.id"), nullable=False),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("manager_user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        sa.Column("reversed_at", TS, nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("receipt_id", name="uq_cash_reversals_receipt"),
        sa.CheckConstraint(
            "kind in ('CASH_RETURNED', 'ERRONEOUS_ENTRY')", name="ck_cash_reversals_kind"
        ),
        sa.CheckConstraint("amount_paise >= 0", name="ck_cash_reversals_amount"),
        sa.CheckConstraint(
            "char_length(reason) between 5 and 300", name="ck_cash_reversals_reason"
        ),
    )
    op.create_index(
        "ix_cash_reversals_canteen_reversed", "cash_reversals", ["canteen_id", "reversed_at"]
    )

    op.create_table(
        "pickup_credentials",
        _id(),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("student_user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("revoked_at", TS, nullable=True),
        sa.Column("revoked_reason", sa.String(40), nullable=True),
        sa.Column("redeemed_at", TS, nullable=True),
        sa.Column("redeemed_by", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("redeem_idempotency_key", sa.String(80), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_pickup_credentials_token"),
        sa.CheckConstraint("expires_at > created_at", name="ck_pickup_credentials_expiry"),
    )
    op.create_index(
        "uq_pickup_credentials_one_active",
        "pickup_credentials",
        ["order_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL AND redeemed_at IS NULL"),
    )
    op.create_index("ix_pickup_credentials_order", "pickup_credentials", ["order_id", "created_at"])

    op.create_table(
        "pickup_events",
        _id(),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=True),
        sa.Column("credential_id", UUID, sa.ForeignKey("pickup_credentials.id"), nullable=True),
        sa.Column("event_type", sa.String(24), nullable=False),
        sa.Column("actor_user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("outcome", sa.String(40), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "event_type in ('ISSUED', 'VERIFIED', 'VERIFY_REJECTED', 'REDEEMED', "
            "'REDEEM_REJECTED', 'REVOKED')",
            name="ck_pickup_events_type",
        ),
    )
    op.create_index("ix_pickup_events_order", "pickup_events", ["order_id", "created_at"])
    op.create_index("ix_pickup_events_canteen", "pickup_events", ["canteen_id", "created_at"])

    op.create_table(
        "push_subscriptions",
        _id(),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endpoint_hash", sa.String(64), nullable=False),
        sa.Column("endpoint_enc", sa.Text(), nullable=False),
        sa.Column("p256dh_enc", sa.Text(), nullable=False),
        sa.Column("auth_enc", sa.Text(), nullable=False),
        sa.Column("device_label", sa.String(60), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("disabled_reason", sa.String(40), nullable=True),
        sa.Column("expiration_time", TS, nullable=True),
        sa.Column("last_attempt_at", TS, nullable=True),
        sa.Column("last_success_at", TS, nullable=True),
        sa.Column("last_status_code", sa.Integer(), nullable=True),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("endpoint_hash", name="uq_push_subscriptions_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user", "push_subscriptions", ["user_id", "enabled"])

    op.create_table(
        "notifications",
        _id(),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("body", sa.String(300), nullable=False),
        sa.Column("dedupe_key", sa.String(120), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("read_at", TS, nullable=True),
        sa.UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_dedupe"),
    )
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])

    op.create_table(
        "notification_outbox",
        _id(),
        sa.Column("event_key", sa.String(120), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column(
            "recipient_user_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("order_version", sa.Integer(), nullable=True),
        sa.Column("notification_id", UUID, sa.ForeignKey("notifications.id"), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("result", sa.String(32), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", TS, nullable=False),
        sa.Column("locked_until", TS, nullable=True),
        sa.Column("last_error", sa.String(80), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", TS, nullable=True),
        sa.UniqueConstraint("event_key", name="uq_notification_outbox_event"),
        sa.CheckConstraint("status in ('PENDING', 'DONE')", name="ck_notification_outbox_status"),
    )
    op.create_index(
        "ix_notification_outbox_due", "notification_outbox", ["status", "next_attempt_at"]
    )

    op.create_table(
        "push_deliveries",
        _id(),
        sa.Column(
            "outbox_id",
            UUID,
            sa.ForeignKey("notification_outbox.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "subscription_id",
            UUID,
            sa.ForeignKey("push_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", TS, nullable=False),
        sa.Column("locked_until", TS, nullable=True),
        sa.Column("last_attempt_at", TS, nullable=True),
        sa.Column("accepted_at", TS, nullable=True),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("transport", sa.String(16), nullable=True),
        sa.Column("error_code", sa.String(40), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("outbox_id", "subscription_id", name="uq_push_deliveries_event_device"),
        sa.CheckConstraint(
            "status in ('PENDING', 'ACCEPTED', 'REJECTED', 'GONE', 'FAILED', 'SKIPPED')",
            name="ck_push_deliveries_status",
        ),
    )
    op.create_index("ix_push_deliveries_due", "push_deliveries", ["status", "next_attempt_at"])

    # Append-only ledgers. Corrections are new rows, never edits or deletes.
    op.execute(
        """
        CREATE FUNCTION bowlbyte_forbid_ledger_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    for table in ("cash_receipts", "cash_reversals", "pickup_events"):
        op.execute(
            f"""
            CREATE TRIGGER {table}_append_only
            BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION bowlbyte_forbid_ledger_change()
            """
        )


def downgrade() -> None:
    for table in ("cash_receipts", "cash_reversals", "pickup_events"):
        op.execute(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table}")
    for name in (
        "push_deliveries",
        "notification_outbox",
        "notifications",
        "push_subscriptions",
        "pickup_events",
        "pickup_credentials",
        "cash_reversals",
        "cash_receipts",
    ):
        op.drop_table(name)
    op.execute("DROP FUNCTION IF EXISTS bowlbyte_forbid_ledger_change()")
    op.execute("DROP SEQUENCE IF EXISTS cash_receipt_no_seq")
    op.drop_column("order_payments", "paid_by")
    op.drop_column("order_payments", "paid_at")
    op.drop_column("orders", "picked_up_by")
    op.drop_column("orders", "picked_up_at")
