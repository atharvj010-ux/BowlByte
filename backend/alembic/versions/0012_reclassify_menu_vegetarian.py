"""Reclassify menu vegetarian flags from name and description.

The first vegetarian migration defaulted every row to veg and only scanned
names with a brittle pattern. Chicken dishes (and similar) that stayed marked
veg are corrected here, and descriptions are included.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0012_reclassify_menu_vegetarian"
down_revision: str | None = "0011_menu_vegetarian"
branch_labels = None
depends_on = None

# Postgres POSIX word edges: \m start, \M end. Keep markers aligned with
# app.services.menu_diet.NON_VEG_MARKERS.
_MARKERS = (
    "chicken",
    "mutton",
    "eggs?",
    "fish",
    "keema",
    "prawns?",
    "shrimp",
    "seafood",
    "bacon",
    "ham",
    "sausage",
    "lamb",
    "beef",
    "pork",
    "turkey",
    "duck",
    "pepperoni",
    "salami",
    r"non[\s\-]*veg",
    "nonveg",
    "meat",
    "seekh",
    "shawarma",
    "kebab",
    "kabab",
    "murgh",
    "gosht",
    "roe",
    r"anchov(?:y|ies)",
    "tuna",
    "salmon",
)


def upgrade() -> None:
    alt = "|".join(_MARKERS)
    pattern = rf"\m(?:{alt})\M"
    op.execute(
        sa.text(
            """
            UPDATE menu_items
            SET is_vegetarian = NOT (
              name ~* :pattern
              OR coalesce(description, '') ~* :pattern
            )
            """
        ).bindparams(pattern=pattern)
    )


def downgrade() -> None:
    # Irreversible data correction; leave flags as they are.
    pass
