"""Preparation tasks, readiness timestamps, and stored ETA metadata."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_kitchen_queue"
down_revision: str | None = "0003_menu_ordering"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("orders", sa.Column("accepted_at", TS, nullable=True))
    op.add_column("orders", sa.Column("ready_at", TS, nullable=True))
    op.add_column("orders", sa.Column("eta_ready_at", TS, nullable=True))
    op.add_column("orders", sa.Column("eta_earliest_at", TS, nullable=True))
    op.add_column("orders", sa.Column("eta_latest_at", TS, nullable=True))
    op.add_column("orders", sa.Column("eta_computed_at", TS, nullable=True))
    op.add_column(
        "orders",
        sa.Column("eta_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "orders",
        sa.Column("eta_overdue", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "orders",
        sa.Column("eta_blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "preparation_tasks",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("order_item_id", UUID, sa.ForeignKey("order_items.id"), nullable=False),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column(
            "kitchen_station_id",
            UUID,
            sa.ForeignKey("kitchen_stations.id"),
            nullable=False,
        ),
        sa.Column("station_name", sa.Text(), nullable=False),
        sa.Column("item_name", sa.Text(), nullable=False),
        sa.Column("unit_index", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("expected_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("extra_delay_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delay_reason", sa.Text(), nullable=True),
        sa.Column("started_at", TS, nullable=True),
        sa.Column("completed_at", TS, nullable=True),
        sa.Column("started_by", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("completed_by", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("order_item_id", "unit_index", name="uq_preparation_tasks_unit"),
        sa.CheckConstraint("unit_index >= 1", name="ck_preparation_tasks_unit"),
        sa.CheckConstraint(
            "expected_duration_seconds >= 30 AND expected_duration_seconds <= 7200",
            name="ck_preparation_tasks_duration",
        ),
        sa.CheckConstraint("extra_delay_seconds >= 0", name="ck_preparation_tasks_delay"),
        sa.CheckConstraint(
            "status in ('QUEUED', 'IN_PROGRESS', 'DONE', 'CANCELLED')",
            name="ck_preparation_tasks_status",
        ),
    )
    op.create_index("ix_preparation_tasks_order_id", "preparation_tasks", ["order_id"])
    op.create_index(
        "ix_preparation_tasks_station_status",
        "preparation_tasks",
        ["kitchen_station_id", "status"],
    )
    op.create_index(
        "ix_preparation_tasks_canteen_status",
        "preparation_tasks",
        ["canteen_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_preparation_tasks_canteen_status", table_name="preparation_tasks")
    op.drop_index("ix_preparation_tasks_station_status", table_name="preparation_tasks")
    op.drop_index("ix_preparation_tasks_order_id", table_name="preparation_tasks")
    op.drop_table("preparation_tasks")
    op.drop_column("orders", "eta_blocked")
    op.drop_column("orders", "eta_overdue")
    op.drop_column("orders", "eta_version")
    op.drop_column("orders", "eta_computed_at")
    op.drop_column("orders", "eta_latest_at")
    op.drop_column("orders", "eta_earliest_at")
    op.drop_column("orders", "eta_ready_at")
    op.drop_column("orders", "ready_at")
    op.drop_column("orders", "accepted_at")
