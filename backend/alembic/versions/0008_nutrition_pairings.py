"""Menu nutrition fields and manager-defined pairings."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_nutrition_pairings"
down_revision: str | None = "0007_pickup_holds"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("menu_items", sa.Column("calories_kcal", sa.Integer(), nullable=True))
    op.add_column("menu_items", sa.Column("serving_size_description", sa.String(80), nullable=True))
    op.add_column("menu_items", sa.Column("nutrition_source", sa.String(16), nullable=True))
    op.add_column("menu_items", sa.Column("nutrition_reference", sa.String(160), nullable=True))
    op.create_check_constraint(
        "ck_menu_items_calories",
        "menu_items",
        "calories_kcal IS NULL OR (calories_kcal >= 0 AND calories_kcal <= 5000)",
    )
    op.create_check_constraint(
        "ck_menu_items_nutrition_pair",
        "menu_items",
        "(calories_kcal IS NULL) = (nutrition_source IS NULL)",
    )
    op.create_check_constraint(
        "ck_menu_items_nutrition_source",
        "menu_items",
        "nutrition_source IS NULL OR nutrition_source IN ('VERIFIED', 'ILLUSTRATIVE')",
    )
    op.create_table(
        "menu_item_pairings",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column(
            "source_item_id",
            UUID,
            sa.ForeignKey("menu_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "suggested_item_id",
            UUID,
            sa.ForeignKey("menu_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("source_item_id", "suggested_item_id", name="uq_menu_item_pairings"),
        sa.CheckConstraint(
            "source_item_id <> suggested_item_id",
            name="ck_menu_item_pairings_distinct",
        ),
        sa.CheckConstraint(
            "priority >= 0 AND priority <= 100",
            name="ck_menu_item_pairings_priority",
        ),
    )
    op.create_index(
        "ix_menu_item_pairings_source",
        "menu_item_pairings",
        ["canteen_id", "source_item_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_menu_item_pairings_source", table_name="menu_item_pairings")
    op.drop_table("menu_item_pairings")
    op.drop_constraint("ck_menu_items_nutrition_source", "menu_items", type_="check")
    op.drop_constraint("ck_menu_items_nutrition_pair", "menu_items", type_="check")
    op.drop_constraint("ck_menu_items_calories", "menu_items", type_="check")
    op.drop_column("menu_items", "nutrition_reference")
    op.drop_column("menu_items", "nutrition_source")
    op.drop_column("menu_items", "serving_size_description")
    op.drop_column("menu_items", "calories_kcal")
