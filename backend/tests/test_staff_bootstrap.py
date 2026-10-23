"""Isolated tests for initial staff provisioning. Never touch live Supabase Auth."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.identity import (
    CANTEEN_MANAGER,
    CASHIER,
    KITCHEN_STAFF,
    MEMBERSHIP_ACTIVE,
    PENDING_VERIFICATION,
    STUDENT,
    StaffMembership,
    User,
)
from app.services.identity import ensure_canteen, ensure_college
from app.services.staff_bootstrap import (
    StaffBootstrapError,
    StaffSlot,
    provision_initial_staff,
    provision_staff_slot,
)
from tests.disposable_guard import require_disposable_database

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def _disposable() -> None:
    try:
        require_disposable_database()
    except pytest.fail.Exception as exc:
        pytest.skip(str(exc))
    except Exception as exc:  # pragma: no cover - connectivity
        pytest.skip(f"Disposable database unavailable: {exc}")


def _clear_settings() -> None:
    get_settings.cache_clear()


def _disable_supabase() -> None:
    settings = get_settings()
    settings.supabase_url = ""
    settings.supabase_secret_key = ""
    settings.supabase_publishable_key = ""
    settings.supabase_credentials_rotated = ""


def _set_emails(kitchen: str, manager: str, cashier: str) -> None:
    settings = get_settings()
    settings.initial_kitchen_email = kitchen
    settings.initial_manager_email = manager
    settings.initial_cashier_email = cashier
    settings.initial_canteen_id = ""


def test_dry_run_and_apply_are_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    _clear_settings()
    _disable_supabase()
    kitchen = f"kitchen-{uuid.uuid4().hex[:8]}@example.com"
    manager = f"manager-{uuid.uuid4().hex[:8]}@example.com"
    cashier = f"cashier-{uuid.uuid4().hex[:8]}@example.com"
    _set_emails(kitchen, manager, cashier)

    db = SessionLocal()
    try:
        canteen, dry = provision_initial_staff(db, password=PASSWORD, apply=False)
        assert canteen.slug
        assert {row.status for row in dry} == {"CREATED"}
        assert db.scalar(select(User).where(User.email == kitchen)) is None

        _, first = provision_initial_staff(db, password=PASSWORD, apply=True)
        assert all(row.status == "CREATED" for row in first)
        roles = {
            db.scalar(select(User).where(User.email == kitchen)).role,
            db.scalar(select(User).where(User.email == manager)).role,
            db.scalar(select(User).where(User.email == cashier)).role,
        }
        assert roles == {KITCHEN_STAFF, CANTEEN_MANAGER, CASHIER}

        _, second = provision_initial_staff(db, password=PASSWORD, apply=True)
        assert all(row.status == "ALREADY_CONFIGURED" for row in second)
        assert db.scalar(select(User.id).where(User.email == kitchen)) is not None
        memberships = db.scalars(select(StaffMembership)).all()
        assert len([row for row in memberships if row.status == MEMBERSHIP_ACTIVE]) >= 3
    finally:
        db.close()
        _clear_settings()


def test_refuses_to_promote_an_existing_student(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    _clear_settings()
    _disable_supabase()
    email = f"student-{uuid.uuid4().hex[:8]}@example.com"
    db = SessionLocal()
    try:
        college = ensure_college(db)
        canteen = ensure_canteen(db, college, name="Pilot Canteen", slug="pilot")
        db.add(
            User(
                college_id=college.id,
                full_name="Existing Student",
                email=email,
                password_hash=hash_password(PASSWORD),
                role=STUDENT,
                status=PENDING_VERIFICATION,
            )
        )
        db.commit()
        result = provision_staff_slot(
            db,
            slot=StaffSlot(role="KITCHEN_STAFF", full_name="Kitchen Staff", email=email),
            canteen=canteen,
            password=PASSWORD,
            apply=True,
        )
        assert result.status == "CONFLICT"
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        assert user.role == STUDENT
    finally:
        db.close()
        _clear_settings()


def test_unknown_canteen_id_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "")
    _clear_settings()
    _disable_supabase()
    settings = get_settings()
    settings.initial_kitchen_email = "k@example.com"
    settings.initial_manager_email = "m@example.com"
    settings.initial_cashier_email = "c@example.com"
    settings.initial_canteen_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        with pytest.raises(StaffBootstrapError, match="canteen id"):
            provision_initial_staff(db, password=PASSWORD, apply=False)
    finally:
        db.close()
        _clear_settings()
