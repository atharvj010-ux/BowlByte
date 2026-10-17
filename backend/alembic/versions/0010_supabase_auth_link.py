"""Link each BowlByte user to a Supabase Auth identity.

The application user id stays the primary key. Orders, payments, and audit
rows keep their existing foreign keys. The new column is nullable so this
migration does not require Auth users to exist yet.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_supabase_auth_link"
down_revision: str | None = "0009_menu_organization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("supabase_auth_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "uq_users_supabase_auth_user_id",
        "users",
        ["supabase_auth_user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_users_supabase_auth_user_id", table_name="users")
    op.drop_column("users", "supabase_auth_user_id")
