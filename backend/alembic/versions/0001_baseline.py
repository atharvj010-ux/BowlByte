"""Baseline revision.

Domain tables are intentionally absent. Ordering, payments, identity, and
notifications will be migrated with the phases that implement them.
"""

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
