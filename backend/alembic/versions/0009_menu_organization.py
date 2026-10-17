"""Category visibility and menu display order.

Adds manager-controlled fields only. It does not move, hide, or delete rows.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0009_menu_organization"
down_revision: str | None = "0008_nutrition_pairings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "menu_categories",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "menu_items",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "menu_items",
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_menu_categories_display",
        "menu_categories",
        ["canteen_id", "is_active", "sort_order"],
    )
    op.create_index(
        "ix_menu_items_display",
        "menu_items",
        ["category_id", "sort_order"],
    )


def downgrade() -> None:
    op.drop_index("ix_menu_items_display", table_name="menu_items")
    op.drop_index("ix_menu_categories_display", table_name="menu_categories")
    op.drop_column("menu_items", "is_featured")
    op.drop_column("menu_items", "sort_order")
    op.drop_column("menu_categories", "is_active")
