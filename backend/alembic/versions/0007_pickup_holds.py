"""Canteen pickup holds and audited unclaimed decisions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_pickup_holds"
down_revision: str | None = "0006_food_intelligence"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column(
        "canteens",
        sa.Column("pickup_hold_minutes", sa.Integer(), server_default="30", nullable=False),
    )
    op.create_check_constraint(
        "ck_canteens_pickup_hold",
        "canteens",
        "pickup_hold_minutes >= 5 AND pickup_hold_minutes <= 180",
    )
    op.add_column("orders", sa.Column("pickup_hold_until", TS, nullable=True))
    op.add_column("orders", sa.Column("unclaimed_at", TS, nullable=True))
    op.add_column("orders", sa.Column("unclaimed_warned_at", TS, nullable=True))
    op.create_index("ix_orders_status_hold", "orders", ["status", "pickup_hold_until"])
    op.create_table(
        "order_hold_events",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("actor_user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("note", sa.String(240), nullable=True),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "action in ('WARNED', 'UNCLAIMED', 'EXTENDED', 'REVIEWED')",
            name="ck_order_hold_events_action",
        ),
    )
    op.create_index("ix_order_hold_events_order_id", "order_hold_events", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_order_hold_events_order_id", table_name="order_hold_events")
    op.drop_table("order_hold_events")
    op.drop_index("ix_orders_status_hold", table_name="orders")
    op.drop_column("orders", "unclaimed_warned_at")
    op.drop_column("orders", "unclaimed_at")
    op.drop_column("orders", "pickup_hold_until")
    op.drop_constraint("ck_canteens_pickup_hold", "canteens", type_="check")
    op.drop_column("canteens", "pickup_hold_minutes")
