"""Provision the three initial Admin desk identities.

Reads emails from BOWLBYTE_INITIAL_*_EMAIL. Optionally creates missing Supabase
Auth users when BOWLBYTE_INITIAL_STAFF_PASSWORD is set (or typed at a prompt).
Never prints the password. Never accepts the password as a CLI argument.

Examples:
  python -m app.cli.bootstrap_staff --dry-run
  python -m app.cli.bootstrap_staff --apply
"""

from __future__ import annotations

import getpass
import os
import sys

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.staff_bootstrap import StaffBootstrapError, provision_initial_staff
from app.services.supabase_auth import supabase_auth_enabled


def _password_from_operator() -> str | None:
    env_password = os.environ.get("BOWLBYTE_INITIAL_STAFF_PASSWORD", "")
    if env_password:
        return env_password
    if not sys.stdin.isatty():
        return None
    typed = getpass.getpass(
        "Initial staff password (blank to link existing Supabase Auth users only): "
    )
    return typed or None


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    dry_run = "--dry-run" in args
    apply = "--apply" in args
    if dry_run == apply:
        print("Choose exactly one of --dry-run or --apply.", file=sys.stderr)
        return 2
    unknown = [item for item in args if item not in {"--dry-run", "--apply"}]
    if unknown:
        print("This command only accepts --dry-run or --apply.", file=sys.stderr)
        return 2

    settings = get_settings()
    password = None
    if apply:
        password = _password_from_operator()
        if supabase_auth_enabled(settings) and password is None:
            print(
                "No password provided. Will link existing Supabase Auth users only.",
                file=sys.stderr,
            )
        confirm_env = os.environ.get("BOWLBYTE_BOOTSTRAP_CONFIRM", "").strip()
        if confirm_env and confirm_env != "APPLY":
            print("BOWLBYTE_BOOTSTRAP_CONFIRM must be APPLY.", file=sys.stderr)
            return 1
        if apply and not confirm_env:
            if not sys.stdin.isatty():
                print(
                    "Refusing non-interactive apply without BOWLBYTE_BOOTSTRAP_CONFIRM=APPLY.",
                    file=sys.stderr,
                )
                return 1
            confirm = input("Type APPLY to create or repair the three staff accounts: ").strip()
            if confirm != "APPLY":
                print("Cancelled.", file=sys.stderr)
                return 1

    db = SessionLocal()
    try:
        canteen, results = provision_initial_staff(db, password=password, apply=apply)
    except StaffBootstrapError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        db.close()

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"{mode} canteen={canteen.slug} id={canteen.id}")
    failed = False
    for row in results:
        print(f"{row.status}\t{row.role}\t{row.email}\t{row.detail}")
        if row.status in {"CONFLICT", "INVALID", "MISSING_AUTH"}:
            failed = True
    print("Password was not written to the log.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
