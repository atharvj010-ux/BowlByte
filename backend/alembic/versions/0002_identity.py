"""Identity, sessions, invitations, and audit records."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_identity"
down_revision: str | None = "0001_baseline"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "colleges",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slug", name="uq_colleges_slug"),
    )
    op.create_table(
        "canteens",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("college_id", UUID, sa.ForeignKey("colleges.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slug", name="uq_canteens_slug"),
    )
    op.create_index("ix_canteens_college_id", "canteens", ["college_id"])
    op.create_table(
        "users",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("college_id", UUID, sa.ForeignKey("colleges.id"), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("email_verified_at", TS, nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "role in ('STUDENT', 'KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')",
            name="ck_users_role",
        ),
        sa.CheckConstraint(
            "status in ('PENDING_VERIFICATION', 'ACTIVE', 'DISABLED')",
            name="ck_users_status",
        ),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lower"),
    )
    op.create_index("uq_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_college_id", "users", ["college_id"])
    op.create_table(
        "student_profiles",
        sa.Column(
            "user_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("college_id", UUID, sa.ForeignKey("colleges.id"), nullable=False),
        sa.Column("roll_number", sa.String(32), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("college_id", "roll_number", name="uq_student_roll"),
    )
    op.create_table(
        "staff_memberships",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "role in ('KITCHEN_STAFF', 'CASHIER', 'CANTEEN_MANAGER')",
            name="ck_staff_memberships_role",
        ),
        sa.CheckConstraint(
            "status in ('ACTIVE', 'INACTIVE')",
            name="ck_staff_memberships_status",
        ),
        sa.UniqueConstraint("user_id", "canteen_id", name="uq_staff_membership"),
    )
    op.create_index("ix_staff_memberships_canteen_id", "staff_memberships", ["canteen_id"])
    op.create_table(
        "student_roster_entries",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("college_id", UUID, sa.ForeignKey("colleges.id"), nullable=False),
        sa.Column("roll_number", sa.String(32), nullable=False),
        sa.Column("enrollment_code_hash", sa.Text(), nullable=False),
        sa.Column("claimed_user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("claimed_at", TS, nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("college_id", "roll_number", name="uq_roster_roll"),
    )
    op.create_table(
        "email_verification_tokens",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("consumed_at", TS, nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("token_hash", name="uq_email_verification_token_hash"),
    )
    op.create_index(
        "ix_email_verification_tokens_user_id",
        "email_verification_tokens",
        ["user_id"],
    )
    op.create_table(
        "staff_invitations",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("consumed_at", TS, nullable=True),
        sa.Column("invited_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "role in ('KITCHEN_STAFF', 'CASHIER')",
            name="ck_staff_invitations_role",
        ),
        sa.UniqueConstraint("token_hash", name="uq_staff_invitation_token_hash"),
    )
    op.create_index("ix_staff_invitations_canteen_id", "staff_invitations", ["canteen_id"])
    op.create_table(
        "sessions",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "user_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("csrf_token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", TS, nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_sessions_token_hash"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table(
        "audit_log",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("actor_user_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("target_type", sa.String(80), nullable=True),
        sa.Column("target_id", sa.String(80), nullable=True),
        sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_audit_log_actor_user_id", "audit_log", ["actor_user_id"])
    op.create_index("ix_audit_log_canteen_id", "audit_log", ["canteen_id"])
    op.execute(
        """
        CREATE FUNCTION set_users_updated_at() RETURNS trigger AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER users_set_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION set_users_updated_at()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS users_set_updated_at ON users")
    op.execute("DROP FUNCTION IF EXISTS set_users_updated_at()")
    op.drop_table("audit_log")
    op.drop_table("sessions")
    op.drop_table("staff_invitations")
    op.drop_table("email_verification_tokens")
    op.drop_table("student_roster_entries")
    op.drop_table("staff_memberships")
    op.drop_table("student_profiles")
    op.drop_table("users")
    op.drop_table("canteens")
    op.drop_table("colleges")
