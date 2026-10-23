"""Idempotent provisioning of the three initial staff identities.

Roles stay on BowlByte rows. Supabase Auth holds passwords only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import dummy_password_hash, hash_password
from app.models.identity import (
    ACTIVE,
    MEMBERSHIP_ACTIVE,
    STUDENT,
    Canteen,
    StaffMembership,
    User,
)
from app.services.identity import (
    _audit,
    _auth_link,
    _set_auth_link,
    ensure_canteen,
    ensure_college,
    normalize_email,
    utcnow,
)
from app.services.supabase_auth import (
    SupabaseAuthClient,
    SupabaseAuthError,
    supabase_auth_enabled,
)
from app.services.supabase_auth_admin import AuthAdminError, SupabaseAuthAdmin

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

StaffRole = Literal["KITCHEN_STAFF", "CANTEEN_MANAGER", "CASHIER"]
ProvisionStatus = Literal[
    "CREATED",
    "LINKED",
    "ALREADY_CONFIGURED",
    "CONFLICT",
    "MISSING_AUTH",
    "INVALID",
]


@dataclass(frozen=True)
class StaffSlot:
    role: StaffRole
    full_name: str
    email: str


@dataclass(frozen=True)
class StaffProvisionResult:
    role: StaffRole
    email: str
    status: ProvisionStatus
    detail: str
    user_id: str | None = None


class StaffBootstrapError(Exception):
    """Operator-facing bootstrap failure."""


def configured_staff_slots() -> list[StaffSlot]:
    settings = get_settings()
    return [
        StaffSlot(
            role="KITCHEN_STAFF",
            full_name="Kitchen Staff",
            email=normalize_email(settings.initial_kitchen_email),
        ),
        StaffSlot(
            role="CANTEEN_MANAGER",
            full_name="Canteen Manager",
            email=normalize_email(settings.initial_manager_email),
        ),
        StaffSlot(
            role="CASHIER",
            full_name="Cashier",
            email=normalize_email(settings.initial_cashier_email),
        ),
    ]


def resolve_canteen(db: Session) -> Canteen:
    settings = get_settings()
    college = ensure_college(db)
    raw_id = (settings.initial_canteen_id or "").strip()
    if raw_id:
        try:
            canteen_id = UUID(raw_id)
        except ValueError as exc:
            raise StaffBootstrapError("BOWLBYTE_INITIAL_CANTEEN_ID is not a valid UUID.") from exc
        canteen = db.get(Canteen, canteen_id)
        if canteen is None:
            raise StaffBootstrapError("The configured canteen id does not exist.")
        return canteen
    return ensure_canteen(
        db,
        college,
        name=settings.canteen_name,
        slug=settings.canteen_slug,
    )


def _validate_slot(slot: StaffSlot) -> str | None:
    if not slot.email:
        return "Email is not configured."
    if _EMAIL.fullmatch(slot.email) is None:
        return "Email syntax is invalid."
    return None


def _active_membership(
    db: Session, user_id: UUID, canteen_id: UUID, role: str
) -> StaffMembership | None:
    return db.scalar(
        select(StaffMembership).where(
            StaffMembership.user_id == user_id,
            StaffMembership.canteen_id == canteen_id,
            StaffMembership.role == role,
            StaffMembership.status == MEMBERSHIP_ACTIVE,
        )
    )


def _ensure_membership(db: Session, user: User, canteen: Canteen, role: str) -> None:
    existing = db.scalar(
        select(StaffMembership).where(
            StaffMembership.user_id == user.id,
            StaffMembership.canteen_id == canteen.id,
            StaffMembership.role == role,
        )
    )
    if existing is None:
        db.add(
            StaffMembership(
                user_id=user.id,
                canteen_id=canteen.id,
                role=role,
                status=MEMBERSHIP_ACTIVE,
            )
        )
        return
    existing.status = MEMBERSHIP_ACTIVE


def _find_auth_id(email: str) -> str | None:
    settings = get_settings()
    if not supabase_auth_enabled(settings):
        return None
    try:
        return SupabaseAuthAdmin(settings.supabase_url, settings.supabase_secret_key).find_user_id(
            email
        )
    except AuthAdminError as exc:
        raise StaffBootstrapError(
            "Supabase Auth admin lookup failed. Check SUPABASE_URL and SUPABASE_SECRET_KEY."
        ) from exc


def _create_or_link_auth(db: Session, user: User, password: str | None) -> tuple[str, str]:
    """Return (auth_id, status_note) where status_note is LINKED or CREATED."""

    existing_link = _auth_link(db, user.id)
    if existing_link:
        return existing_link, "ALREADY_CONFIGURED"
    found = _find_auth_id(user.email)
    if found:
        _set_auth_link(db, user.id, found)
        return found, "LINKED"
    if not supabase_auth_enabled(get_settings()):
        return "", "CREATED"
    if not password:
        raise StaffBootstrapError(
            f"No Supabase Auth user for {user.email}. Create it in the dashboard "
            "or provide BOWLBYTE_INITIAL_STAFF_PASSWORD for one trusted create."
        )
    try:
        auth_id = SupabaseAuthClient(get_settings()).create_user(
            user.email,
            password,
            email_confirm=True,
        )
    except SupabaseAuthError as exc:
        # A race or prior create: try lookup again.
        found = _find_auth_id(user.email)
        if found:
            _set_auth_link(db, user.id, found)
            return found, "LINKED"
        raise StaffBootstrapError(
            f"Supabase Auth could not create {user.email} (HTTP {exc.status})."
        ) from exc
    _set_auth_link(db, user.id, auth_id)
    return auth_id, "CREATED"


def provision_staff_slot(
    db: Session,
    *,
    slot: StaffSlot,
    canteen: Canteen,
    password: str | None,
    apply: bool,
) -> StaffProvisionResult:
    problem = _validate_slot(slot)
    if problem:
        return StaffProvisionResult(slot.role, slot.email or "(empty)", "INVALID", problem)

    user = db.scalar(select(User).where(User.email == slot.email))
    if user is not None and user.role == STUDENT:
        return StaffProvisionResult(
            slot.role,
            slot.email,
            "CONFLICT",
            "An existing student account uses this email. Refusing to promote it.",
            user_id=str(user.id),
        )
    if user is not None and user.role != slot.role:
        return StaffProvisionResult(
            slot.role,
            slot.email,
            "CONFLICT",
            f"Existing account role is {user.role}, expected {slot.role}.",
            user_id=str(user.id),
        )

    membership_ok = (
        user is not None and _active_membership(db, user.id, canteen.id, slot.role) is not None
    )
    auth_ok = user is not None and bool(_auth_link(db, user.id))
    if (
        user is not None
        and user.status == ACTIVE
        and membership_ok
        and (auth_ok or not supabase_auth_enabled(get_settings()))
    ):
        return StaffProvisionResult(
            slot.role,
            slot.email,
            "ALREADY_CONFIGURED",
            "User, role, canteen membership, and Auth link are already correct.",
            user_id=str(user.id),
        )

    if not apply:
        action = "create" if user is None else "repair"
        return StaffProvisionResult(
            slot.role,
            slot.email,
            "CREATED" if user is None else "LINKED",
            f"Dry-run would {action} {slot.role} for canteen {canteen.slug}.",
            user_id=str(user.id) if user else None,
        )

    now = utcnow()
    created = False
    if user is None:
        user = User(
            college_id=canteen.college_id,
            full_name=slot.full_name,
            email=slot.email,
            # Local hash is unused when Supabase Auth is enabled; keep a dummy.
            password_hash=hash_password(password) if password else dummy_password_hash(),
            role=slot.role,
            status=ACTIVE,
            email_verified_at=now,
        )
        db.add(user)
        db.flush()
        created = True
    else:
        user.full_name = slot.full_name
        user.status = ACTIVE
        user.email_verified_at = user.email_verified_at or now
        if password and not supabase_auth_enabled(get_settings()):
            user.password_hash = hash_password(password)

    _ensure_membership(db, user, canteen, slot.role)
    auth_note = "CREATED"
    if supabase_auth_enabled(get_settings()):
        try:
            _auth_id, auth_note = _create_or_link_auth(db, user, password)
            del _auth_id
        except StaffBootstrapError as exc:
            db.rollback()
            return StaffProvisionResult(slot.role, slot.email, "MISSING_AUTH", str(exc))

    _audit(
        db,
        action="staff.initial_provisioned",
        actor_user_id=user.id,
        target_type="user",
        target_id=str(user.id),
        canteen_id=canteen.id,
        metadata={"role": slot.role, "created": created, "auth": auth_note},
    )
    db.commit()
    db.refresh(user)
    status: ProvisionStatus = "CREATED" if created else "LINKED"
    if auth_note == "ALREADY_CONFIGURED" and not created:
        status = "ALREADY_CONFIGURED"
    return StaffProvisionResult(
        slot.role,
        slot.email,
        status,
        f"Ready for {canteen.slug}. Auth: {auth_note}.",
        user_id=str(user.id),
    )


def provision_initial_staff(
    db: Session,
    *,
    password: str | None = None,
    apply: bool = False,
) -> tuple[Canteen, list[StaffProvisionResult]]:
    slots = configured_staff_slots()
    emails = [slot.email for slot in slots if slot.email]
    if len(emails) != len(set(emails)):
        raise StaffBootstrapError("The three initial staff emails must be unique.")
    if password is not None and (len(password) < 12 or len(password) > 128):
        raise StaffBootstrapError("Password must be between 12 and 128 characters.")
    canteen = resolve_canteen(db)
    results = [
        provision_staff_slot(db, slot=slot, canteen=canteen, password=password, apply=apply)
        for slot in slots
    ]
    return canteen, results


def staff_identity_summary(db: Session, email: str) -> dict[str, object]:
    normalized = normalize_email(email)
    user = db.scalar(select(User).where(User.email == normalized))
    if user is None:
        return {"email": normalized, "exists": False}
    link = db.execute(
        text("SELECT supabase_auth_user_id::text FROM users WHERE id = :id"),
        {"id": user.id},
    ).scalar()
    memberships = (
        db.execute(select(StaffMembership).where(StaffMembership.user_id == user.id))
        .scalars()
        .all()
    )
    return {
        "email": normalized,
        "exists": True,
        "user_id": str(user.id),
        "role": user.role,
        "status": user.status,
        "auth_linked": bool(link),
        "memberships": [
            {
                "canteen_id": str(row.canteen_id),
                "role": row.role,
                "status": row.status,
            }
            for row in memberships
        ],
    }
