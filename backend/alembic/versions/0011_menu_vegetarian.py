"""Add vegetarian flag on menu items for student filters.

Existing rows are backfilled from the dish name so chicken, egg, and similar
items are marked non-veg without a manual catalog pass.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0011_menu_vegetarian"
down_revision: str | None = "0010_supabase_auth_link"
branch_labels = None
depends_on = None

# Shared with app.services.menu_diet.infer_is_vegetarian — keep patterns aligned.
_NON_VEG_SQL = r"""
UPDATE menu_items
SET is_vegetarian = false
WHERE name ~* '(^|[^a-z])(chicken|mutton|egg|eggs|fish|keema|prawn|shrimp|seafood|bacon|ham|sausage|lamb|beef|pork|turkey|duck|pepperoni|salami|non[\s-]?veg|nonveg|meat)([^a-z]|$)'
"""


def upgrade() -> None:
    op.add_column(
        "menu_items",
        sa.Column("is_vegetarian", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.execute(sa.text(_NON_VEG_SQL))
    op.alter_column("menu_items", "is_vegetarian", server_default=None)


def downgrade() -> None:
    op.drop_column("menu_items", "is_vegetarian")
