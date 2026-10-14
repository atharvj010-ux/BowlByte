"""Menu, stations, daily stock, and cash-on-pickup orders."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_menu_ordering"
down_revision: str | None = "0002_identity"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "menu_categories",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("canteen_id", "name", name="uq_menu_categories_name"),
    )
    op.create_index("ix_menu_categories_canteen_id", "menu_categories", ["canteen_id"])
    op.create_table(
        "kitchen_stations",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("parallel_capacity", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("parallel_capacity > 0", name="ck_kitchen_stations_capacity"),
        sa.UniqueConstraint("canteen_id", "name", name="uq_kitchen_stations_name"),
    )
    op.create_index("ix_kitchen_stations_canteen_id", "kitchen_stations", ["canteen_id"])
    op.create_table(
        "menu_items",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("category_id", UUID, sa.ForeignKey("menu_categories.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("price_paise", sa.BigInteger(), nullable=False),
        sa.Column("image_bytes", postgresql.BYTEA(), nullable=True),
        sa.Column("image_content_type", sa.String(32), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("prep_seconds", sa.Integer(), nullable=False),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("seed_key", sa.String(80), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("price_paise >= 0", name="ck_menu_items_price"),
        sa.CheckConstraint(
            "prep_seconds >= 30 AND prep_seconds <= 7200", name="ck_menu_items_prep"
        ),
        sa.CheckConstraint(
            "(image_bytes IS NULL) = (image_content_type IS NULL)",
            name="ck_menu_items_image_pair",
        ),
    )
    op.create_index("ix_menu_items_canteen_active", "menu_items", ["canteen_id", "is_active"])
    op.create_index("ix_menu_items_category_id", "menu_items", ["category_id"])
    op.create_index(
        "uq_menu_items_seed_key",
        "menu_items",
        ["canteen_id", "seed_key"],
        unique=True,
        postgresql_where=sa.text("seed_key IS NOT NULL"),
    )
    op.create_table(
        "menu_item_station_assignments",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("menu_item_id", UUID, sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("station_id", UUID, sa.ForeignKey("kitchen_stations.id"), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("menu_item_id", name="uq_menu_item_station"),
    )
    op.create_index(
        "ix_menu_item_station_station_id",
        "menu_item_station_assignments",
        ["station_id"],
    )
    op.create_table(
        "daily_stock",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("menu_item_id", UUID, sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("available_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reserved_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("consumed_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("menu_item_id", "service_date", name="uq_daily_stock_item_date"),
        sa.CheckConstraint("available_qty >= 0", name="ck_daily_stock_available"),
        sa.CheckConstraint("reserved_qty >= 0", name="ck_daily_stock_reserved"),
        sa.CheckConstraint("consumed_qty >= 0", name="ck_daily_stock_consumed"),
    )
    op.create_index("ix_daily_stock_service_date", "daily_stock", ["service_date"])
    op.execute("CREATE SEQUENCE order_ticket_seq")
    op.create_table(
        "orders",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("ticket_number", sa.String(16), nullable=False),
        sa.Column("student_user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("total_paise", sa.BigInteger(), nullable=False),
        sa.Column("payment_method", sa.String(16), nullable=False, server_default="CASH"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("ticket_number", name="uq_orders_ticket_number"),
        sa.CheckConstraint(
            "status in ('PLACED', 'ACCEPTED', 'QUEUED', 'PREPARING', 'READY', "
            "'PICKED_UP', 'REJECTED', 'CANCELLED', 'UNCLAIMED')",
            name="ck_orders_status",
        ),
        sa.CheckConstraint("payment_method = 'CASH'", name="ck_orders_payment_method"),
        sa.CheckConstraint("total_paise >= 0", name="ck_orders_total"),
        sa.CheckConstraint("version >= 1", name="ck_orders_version"),
        sa.CheckConstraint("note IS NULL OR char_length(note) <= 240", name="ck_orders_note"),
    )
    op.create_index("ix_orders_student_created", "orders", ["student_user_id", "created_at"])
    op.create_index(
        "ix_orders_canteen_status_created",
        "orders",
        ["canteen_id", "status", "created_at"],
    )
    op.create_table(
        "order_items",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("menu_item_id", UUID, sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("item_name", sa.Text(), nullable=False),
        sa.Column("unit_price_paise", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("line_total_paise", sa.BigInteger(), nullable=False),
        sa.Column("station_id", UUID, sa.ForeignKey("kitchen_stations.id"), nullable=True),
        sa.Column("station_name", sa.Text(), nullable=True),
        sa.Column("prep_seconds", sa.Integer(), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_order_items_quantity"),
        sa.CheckConstraint("unit_price_paise >= 0", name="ck_order_items_price"),
        sa.CheckConstraint(
            "line_total_paise = unit_price_paise * quantity",
            name="ck_order_items_line_total",
        ),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_table(
        "order_events",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("from_status", sa.String(32), nullable=True),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("actor_user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_order_events_order_id", "order_events", ["order_id"])
    op.create_table(
        "order_payments",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("method", sa.String(16), nullable=False, server_default="CASH"),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("order_id", name="uq_order_payments_order"),
        sa.CheckConstraint("method = 'CASH'", name="ck_order_payments_method"),
        sa.CheckConstraint(
            "status in ('PENDING', 'PAID', 'VOIDED')",
            name="ck_order_payments_status",
        ),
        sa.CheckConstraint("amount_paise >= 0", name="ck_order_payments_amount"),
    )
    op.create_table(
        "inventory_adjustments",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("daily_stock_id", UUID, sa.ForeignKey("daily_stock.id"), nullable=False),
        sa.Column("menu_item_id", UUID, sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("actor_user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("delta_available", sa.Integer(), nullable=False),
        sa.Column("delta_reserved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reason", sa.String(80), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_inventory_adjustments_stock_id",
        "inventory_adjustments",
        ["daily_stock_id"],
    )
    op.create_index("ix_inventory_adjustments_order_id", "inventory_adjustments", ["order_id"])
    op.create_table(
        "order_idempotency_records",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("student_user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "student_user_id",
            "idempotency_key",
            name="uq_order_idempotency_student_key",
        ),
    )


def downgrade() -> None:
    op.drop_table("order_idempotency_records")
    op.drop_table("inventory_adjustments")
    op.drop_table("order_payments")
    op.drop_table("order_events")
    op.drop_table("order_items")
    op.drop_table("orders")
    op.execute("DROP SEQUENCE IF EXISTS order_ticket_seq")
    op.drop_table("daily_stock")
    op.drop_table("menu_item_station_assignments")
    op.drop_table("menu_items")
    op.drop_table("kitchen_stations")
    op.drop_table("menu_categories")
