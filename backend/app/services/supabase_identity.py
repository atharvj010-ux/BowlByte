"""Plan a Supabase Auth identity for an existing BowlByte user.

Application roles stay on the BowlByte user row. This module never copies a
role into Auth user_metadata, and it never invents a password.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from urllib.parse import urlparse

_ARGON2ID = re.compile(
    r"^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$"
)
# GoTrue rejects Argon2 parameters that do not fit its parser:
# memory and time must fit in 32 bits, and parallelism must fit in 8 bits.
_MAX_MEMORY = 2**32 - 1
_MAX_TIME = 2**32 - 1
_MAX_PARALLELISM = 255

CUTOVER_ENV = (
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_DB_URL",
)


@dataclass(frozen=True)
class IdentitySource:
    email: str
    status: str
    email_verified_at: datetime | None
    password_hash: str
    supabase_auth_user_id: str | None = None


@dataclass(frozen=True)
class IdentityPlan:
    action: str
    email_confirm: bool
    reason: str


class AuthAdmin(Protocol):
    def find_user_id(self, email: str) -> str | None: ...

    def create_user(self, email: str, password_hash: str, *, email_confirm: bool) -> str: ...


def password_hash_importable(password_hash: str) -> bool:
    """Return whether GoTrue's documented Argon2id importer can read this hash."""

    match = _ARGON2ID.fullmatch(password_hash)
    if match is None:
        return False
    memory, time_cost, parallelism = (int(part) for part in match.groups())
    return (
        1 <= memory <= _MAX_MEMORY
        and 1 <= time_cost <= _MAX_TIME
        and 1 <= parallelism <= _MAX_PARALLELISM
    )


def plan_identity(source: IdentitySource) -> IdentityPlan:
    if source.supabase_auth_user_id:
        return IdentityPlan("linked", False, "already_linked")
    if source.status == "DISABLED":
        return IdentityPlan("skip", False, "disabled")
    if not password_hash_importable(source.password_hash):
        return IdentityPlan("reset_required", False, "unsupported_hash")
    verified = source.status == "ACTIVE" and source.email_verified_at is not None
    if verified:
        return IdentityPlan("import", True, "verified")
    return IdentityPlan("import", False, "unverified")


def apply_identity(admin: AuthAdmin, source: IdentitySource) -> IdentityPlan:
    """Create or reuse an Auth user. The caller stores the returned id."""

    plan = plan_identity(source)
    if plan.action != "import":
        return plan
    existing = admin.find_user_id(source.email)
    if existing:
        return IdentityPlan("link_existing", plan.email_confirm, existing)
    created = admin.create_user(
        source.email,
        source.password_hash,
        email_confirm=plan.email_confirm,
    )
    return IdentityPlan("created", plan.email_confirm, created)


def secret_key_usable(secret: str) -> bool:
    text = secret.strip()
    if len(text) < 20 or text.startswith("sb_publishable"):
        return False
    return "publishable" not in text.lower()


def database_url_usable(url: str) -> str | None:
    """Return an error message when the URL is unsafe for the Supabase cutover."""

    text = url.strip()
    if not text:
        return "SUPABASE_DB_URL is empty."
    if "sslmode=disable" in text.lower():
        return "SUPABASE_DB_URL must not disable TLS."
    parsed = urlparse(text.replace("postgresql+psycopg", "postgresql", 1))
    host = (parsed.hostname or "").lower()
    if host in {"", "localhost", "127.0.0.1", "postgres"}:
        return "SUPABASE_DB_URL must point at the Supabase database host."
    if parsed.port == 6543:
        return "Use the direct connection or the session pooler on port 5432."
    if parsed.scheme not in {"postgresql", "postgres"}:
        return "SUPABASE_DB_URL must be a PostgreSQL URI."
    return None


def missing_cutover_names(values: dict[str, str]) -> list[str]:
    missing: list[str] = []
    url = values.get("SUPABASE_URL") or values.get("NEXT_PUBLIC_SUPABASE_URL") or ""
    publishable = values.get("SUPABASE_PUBLISHABLE_KEY") or values.get(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    ) or ""
    secret = values.get("SUPABASE_SECRET_KEY", "")
    database = values.get("SUPABASE_DB_URL", "")
    if not url.strip():
        missing.append("NEXT_PUBLIC_SUPABASE_URL")
    if not publishable.strip():
        missing.append("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    if not secret_key_usable(secret):
        missing.append("SUPABASE_SECRET_KEY")
    if database_url_usable(database):
        missing.append("SUPABASE_DB_URL")
    return missing
