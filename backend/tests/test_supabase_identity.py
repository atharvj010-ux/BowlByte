from datetime import UTC, datetime

from app.services.supabase_identity import (
    IdentitySource,
    apply_identity,
    credentials_rotation_acknowledged,
    database_url_usable,
    missing_cutover_names,
    password_hash_importable,
    plan_identity,
    secret_key_usable,
)

_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$"
    "c29tZXNhbHRzb21lc2FsdA$c29tZWhhc2hzb21laGFzaHNvbWVoYXNo"
)


def test_argon2id_parameters_used_by_bowlbyte_are_importable() -> None:
    assert password_hash_importable(_HASH)
    assert not password_hash_importable("$2b$12$not-an-argon-hash")
    assert not password_hash_importable("$argon2id$v=16$m=65536,t=3,p=4$c29tZQ$c29tZQ")


def test_verified_active_users_keep_verified_status() -> None:
    plan = plan_identity(
        IdentitySource(
            email="student@college.edu",
            status="ACTIVE",
            email_verified_at=datetime(2026, 1, 1, tzinfo=UTC),
            password_hash=_HASH,
        )
    )
    assert plan.action == "import"
    assert plan.email_confirm is True


def test_unverified_and_disabled_users_are_not_confirmed() -> None:
    pending = plan_identity(
        IdentitySource("a@college.edu", "PENDING_VERIFICATION", None, _HASH)
    )
    disabled = plan_identity(IdentitySource("b@college.edu", "DISABLED", None, _HASH))
    assert pending.action == "import"
    assert pending.email_confirm is False
    assert disabled.action == "skip"


def test_apply_links_an_existing_auth_user_without_creating_another() -> None:
    class Admin:
        def find_user_id(self, email: str) -> str | None:
            return "auth-1"

        def create_user(self, email: str, password_hash: str, *, email_confirm: bool) -> str:
            raise AssertionError("existing auth user must be reused")

    result = apply_identity(
        Admin(),
        IdentitySource("a@college.edu", "ACTIVE", datetime(2026, 1, 1, tzinfo=UTC), _HASH),
    )
    assert result.action == "link_existing"
    assert result.reason == "auth-1"


def test_cutover_settings_reject_the_publishable_key_and_transaction_pooler() -> None:
    assert not secret_key_usable("sb_publishable_example")
    assert database_url_usable("postgresql://user:secret@localhost:5432/postgres")
    assert database_url_usable(
        "postgresql://user:secret@aws-0.pooler.supabase.com:6543/postgres"
    )
    missing = missing_cutover_names(
        {
            "NEXT_PUBLIC_SUPABASE_URL": "https://example.supabase.co",
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_example",
            "SUPABASE_SECRET_KEY": "sb_publishable_example",
            "SUPABASE_DB_URL": "",
        }
    )
    assert missing == ["SUPABASE_SECRET_KEY", "SUPABASE_DB_URL"]
    assert credentials_rotation_acknowledged("yes")
    assert not credentials_rotation_acknowledged("")
    assert not credentials_rotation_acknowledged("no")
