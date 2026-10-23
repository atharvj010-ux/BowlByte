"""Import BowlByte users into Supabase Auth and store the identity link.

The command is idempotent. It keeps the BowlByte user id, does not change
orders, and does not copy roles into Auth metadata. Disabled accounts are
skipped. Pending accounts stay unconfirmed.
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import psycopg

from app.services.supabase_auth_admin import AuthAdminError, SupabaseAuthAdmin
from app.services.supabase_identity import (
    IdentitySource,
    apply_identity,
    credentials_rotation_acknowledged,
)


def _load_env() -> None:
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _database_name(url: str) -> str:
    return urlparse(url.replace("postgresql+psycopg", "postgresql", 1)).path.strip("/")


def assert_import_targets(source_url: str, target_url: str, rotation_flag: str) -> None:
    if not credentials_rotation_acknowledged(rotation_flag):
        raise SystemExit("Identity import is refused until credential rotation is acknowledged.")
    source_name = _database_name(source_url)
    target = urlparse(target_url.replace("postgresql+psycopg", "postgresql", 1))
    target_name = target.path.strip("/")
    query = parse_qs(target.query)
    if source_name != "bowlbyte":
        raise SystemExit("Identity import source must be the BowlByte application database.")
    if target_name in {"bowlbyte", "bowlbyte_test", "bowlbyte_e2e", "postgres"} and (
        (target.hostname or "") in {"", "localhost", "127.0.0.1", "postgres"}
    ):
        raise SystemExit("Identity import target must be the Supabase session pooler.")
    if target.port != 5432 or (query.get("sslmode") or [""])[0] != "verify-full":
        raise SystemExit("Identity import target must use port 5432 and sslmode=verify-full.")
    if not (target.hostname or "").endswith("pooler.supabase.com"):
        raise SystemExit("Identity import target must be the Supabase session pooler.")


def _rows(connection: psycopg.Connection) -> dict[str, tuple]:
    found = {}
    for row in connection.execute(
        """
        SELECT id::text, email, status, email_verified_at, password_hash,
               supabase_auth_user_id::text
        FROM users
        """
    ).fetchall():
        found[row[0]] = row
    return found


def _link(connection: psycopg.Connection, user_id: str, auth_id: str) -> None:
    connection.execute(
        """
        UPDATE users
        SET supabase_auth_user_id = %s
        WHERE id = %s
          AND (supabase_auth_user_id IS NULL OR supabase_auth_user_id = %s)
        """,
        (auth_id, user_id, auth_id),
    )


def import_identities(source_url: str, target_url: str, admin: SupabaseAuthAdmin) -> Counter:
    counts: Counter = Counter()
    with (
        psycopg.connect(source_url, connect_timeout=20) as source,
        psycopg.connect(target_url, connect_timeout=20) as target,
    ):
        local = _rows(source)
        remote = _rows(target)
        if set(local) != set(remote):
            raise SystemExit("Local and cloud user ids differ. Import stopped.")
        for user_id, row in local.items():
            _, email, status, verified_at, password_hash, linked = row
            remote_email = remote[user_id][1]
            if remote_email != email:
                counts["email_conflict"] += 1
                continue
            remote_link = remote[user_id][5]
            if linked and remote_link:
                counts["already_linked"] += 1
                continue
            if linked or remote_link:
                auth_id = linked or remote_link
                _link(source, user_id, auth_id)
                _link(target, user_id, auth_id)
                source.commit()
                target.commit()
                counts["already_linked"] += 1
                continue
            verified = verified_at if isinstance(verified_at, datetime) else None
            try:
                plan = apply_identity(
                    admin,
                    IdentitySource(
                        email=email,
                        status=status,
                        email_verified_at=verified,
                        password_hash=password_hash,
                        supabase_auth_user_id=linked or remote_link,
                    ),
                )
                if plan.action == "skip":
                    counts["skipped_disabled"] += 1
                    continue
                if plan.action == "reset_required":
                    counts["reset_required"] += 1
                    continue
                if plan.action == "linked":
                    counts["already_linked"] += 1
                    continue
                if plan.action not in {"created", "link_existing"}:
                    counts["unplanned"] += 1
                    continue
                _link(source, user_id, plan.reason)
                _link(target, user_id, plan.reason)
                source.commit()
                target.commit()
            except AuthAdminError:
                source.rollback()
                target.rollback()
                counts["failed"] += 1
                continue
            counts[plan.action] += 1
            if plan.email_confirm:
                counts["confirmed"] += 1
            else:
                counts["unconfirmed"] += 1
    return counts


def main() -> None:
    _load_env()
    source_url = os.environ.get("SOURCE_DATABASE_URL", "").strip()
    target_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    secret = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    assert_import_targets(
        source_url,
        target_url,
        os.environ.get("SUPABASE_CREDENTIALS_ROTATED", ""),
    )
    if not base_url or not secret:
        raise SystemExit("Supabase Auth settings are missing.")
    counts = import_identities(
        source_url.replace("postgresql+psycopg", "postgresql", 1),
        target_url.replace("postgresql+psycopg", "postgresql", 1),
        SupabaseAuthAdmin(base_url, secret),
    )
    for name in (
        "created",
        "link_existing",
        "already_linked",
        "confirmed",
        "unconfirmed",
        "skipped_disabled",
        "reset_required",
        "email_conflict",
        "failed",
    ):
        print(f"{name} {counts[name]}")


if __name__ == "__main__":
    sys.exit(main())
