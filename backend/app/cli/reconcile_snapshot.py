"""Reconcile a newer BowlByte database onto an older snapshot.

The default run only prints the plan. Apply mode inserts missing order rows
and updates changed stock. It does not delete rows or touch auth.users.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import psycopg

from app.services.reconcile_snapshot import (
    ReconciliationError,
    apply_reconciliation,
    plan_reconciliation,
    summarize_reconciliation,
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


def _name(url: str) -> str:
    return urlparse(url.replace("postgresql+psycopg", "postgresql", 1)).path.strip("/")


def assert_endpoints(source_url: str, target_url: str, *, apply: bool) -> None:
    source = urlparse(source_url.replace("postgresql+psycopg", "postgresql", 1))
    target = urlparse(target_url.replace("postgresql+psycopg", "postgresql", 1))
    if _name(source_url) != "bowlbyte":
        raise SystemExit("Reconciliation source must be the BowlByte database.")
    if (source.hostname or "") not in {"127.0.0.1", "localhost"}:
        raise SystemExit("Reconciliation source must be the local BowlByte database.")
    target_name = _name(target_url)
    query = parse_qs(target.query)
    stage = target_name == "bowlbyte_p014_stage" and (target.hostname or "") in {
        "127.0.0.1",
        "localhost",
    }
    cloud = (
        target.port == 5432
        and (query.get("sslmode") or [""])[0] == "verify-full"
        and (target.hostname or "").endswith("pooler.supabase.com")
        and target_name == "postgres"
    )
    if apply and not (stage or cloud):
        raise SystemExit("Refusing to apply reconciliation to this target.")
    if not apply and not (stage or cloud):
        raise SystemExit("Refusing to read this reconciliation target.")


def main() -> None:
    _load_env()
    apply = "--apply" in sys.argv
    report = "--report" in sys.argv
    source_url = os.environ.get("SOURCE_DATABASE_URL", "").strip()
    target_url = os.environ.get("TARGET_DATABASE_URL", "").strip()
    if not source_url or not target_url:
        raise SystemExit("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required.")
    assert_endpoints(source_url, target_url, apply=apply)
    source_url = source_url.replace("postgresql+psycopg", "postgresql", 1)
    target_url = target_url.replace("postgresql+psycopg", "postgresql", 1)
    try:
        with psycopg.connect(source_url, connect_timeout=30) as source, psycopg.connect(
            target_url, connect_timeout=30
        ) as target:
            if report:
                for table, only_source, only_target, changed in summarize_reconciliation(
                    source, target
                ):
                    print(
                        f"{table} only_source={only_source} "
                        f"only_target={only_target} changed={changed}"
                    )
                return
            if not apply:
                planned = plan_reconciliation(source, target)
                inserts = sum(len(ids) for ids in planned["inserts"].values())
                print(f"insert_rows {inserts}")
                print(f"stock_rows {len(planned['stock'])}")
                for table, ids in planned["inserts"].items():
                    print(f"insert {table} {len(ids)}")
                return
            counts = apply_reconciliation(source, target)
    except ReconciliationError as error:
        print(f"reconciliation_refused {error}")
        raise SystemExit(2) from error
    for name, count in sorted(counts.items()):
        print(f"applied {name} {count}")


if __name__ == "__main__":
    sys.exit(main())
