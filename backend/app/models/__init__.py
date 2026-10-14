"""Domain models registered with Alembic metadata."""

from app.models.identity import (
    AuditLog,
    Canteen,
    College,
    EmailVerificationToken,
    Session,
    StaffInvitation,
    StaffMembership,
    StudentProfile,
    StudentRosterEntry,
    User,
)

__all__ = [
    "AuditLog",
    "Canteen",
    "College",
    "EmailVerificationToken",
    "Session",
    "StaffInvitation",
    "StaffMembership",
    "StudentProfile",
    "StudentRosterEntry",
    "User",
]
