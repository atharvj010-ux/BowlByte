"""Copy newer BowlByte rows onto an older snapshot.

Inserts missing business rows and updates changed stock quantities.
It never deletes rows, never writes the auth schema, and never updates
append-only ledgers. Identity links are left in place.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import psycopg

APPEND_ONLY = frozenset({"cash_receipts", "cash_reversals", "pickup_events"})
SKIP_TABLES = frozenset({"sessions"})
INSERT_ORDER = (
    "orders",
    "order_items",
    "order_payments",
    "order_events",
    "order_idempotency_records",
    "inventory_adjustments",
)
STOCK_COLUMNS = ("available_qty", "reserved_qty", "updated_at")


class ReconciliationError(RuntimeError):
    pass


def _columns(connection: psycopg.Connection, table: str) -> list[str]:
    rows = connection.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    return [row[0] for row in rows]


def _public_tables(connection: psycopg.Connection) -> list[str]:
    rows = connection.execute(
        """
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
        """
    ).fetchall()
    return [row[0] for row in rows]


def _primary_key(connection: psycopg.Connection, table: str) -> list[str]:
    rows = connection.execute(
        """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_name = %s
        ORDER BY kcu.ordinal_position
        """,
        (table,),
    ).fetchall()
    return [row[0] for row in rows]


def _pk_text(columns: list[str]) -> str:
    parts = ", ".join(f"COALESCE(\"{name}\"::text, '')" for name in columns)
    if len(columns) == 1:
        return parts
    return f"concat_ws('|', {parts})"


def _hashes(
    connection: psycopg.Connection, table: str, ignore: set[str] | None = None
) -> dict[str, str]:
    ignored = ignore or set()
    key = _primary_key(connection, table)
    if not key:
        raise ReconciliationError(f"{table} has no primary key.")
    columns = [
        name for name in _columns(connection, table) if name not in ignored and name not in key
    ]
    payload = ", ".join(f"COALESCE(\"{name}\"::text, '')" for name in columns)
    expression = f"md5(concat_ws('|', {payload}))" if columns else "md5('')"
    rows = connection.execute(
        f'SELECT {_pk_text(key)}, {expression} FROM public."{table}"'
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def _require_same_shape(source: psycopg.Connection, target: psycopg.Connection) -> list[str]:
    left = _public_tables(source)
    right = _public_tables(target)
    if left != right:
        raise ReconciliationError("Public table lists differ.")
    for table in left:
        if _columns(source, table) != _columns(target, table):
            raise ReconciliationError(f"Column list differs for {table}.")
        if _primary_key(source, table) != _primary_key(target, table):
            raise ReconciliationError(f"Primary key differs for {table}.")
        if not _primary_key(source, table):
            raise ReconciliationError(f"{table} has no primary key.")
    return left


def summarize_reconciliation(
    source: psycopg.Connection, target: psycopg.Connection
) -> list[tuple[str, int, int, int]]:
    """Return only_source, only_target, and changed counts. No row bodies."""
    tables = _require_same_shape(source, target)
    summary: list[tuple[str, int, int, int]] = []
    for table in tables:
        ignore = {"updated_at"} if table == "users" else set()
        left = _hashes(source, table, ignore)
        right = _hashes(target, table, ignore)
        only_source = set(left) - set(right)
        only_target = set(right) - set(left)
        changed = {key for key in set(left) & set(right) if left[key] != right[key]}
        if only_source or only_target or changed:
            summary.append((table, len(only_source), len(only_target), len(changed)))
    return summary


def plan_reconciliation(source: psycopg.Connection, target: psycopg.Connection) -> dict[str, Any]:
    tables = _require_same_shape(source, target)
    inserts: dict[str, list[str]] = {}
    unexpected: list[str] = []
    for table in tables:
        if table in SKIP_TABLES:
            continue
        ignore = {"updated_at"} if table == "users" else set()
        left = _hashes(source, table, ignore)
        right = _hashes(target, table, ignore)
        only_source = sorted(set(left) - set(right))
        only_target = sorted(set(right) - set(left))
        changed = sorted(key for key in set(left) & set(right) if left[key] != right[key])
        if table == "alembic_version" and (only_source or only_target or changed):
            raise ReconciliationError("Alembic revisions differ.")
        if table == "alembic_version":
            continue
        if table in APPEND_ONLY and (only_source or only_target or changed):
            raise ReconciliationError(f"Append-only table {table} differs.")
        if table in INSERT_ORDER and changed:
            raise ReconciliationError(f"{table} has changed rows.")
        if table == "users" and (only_source or only_target or changed):
            raise ReconciliationError("User rows differ beyond updated_at.")
        if table == "daily_stock":
            if only_source or only_target:
                raise ReconciliationError("Stock rows were inserted or deleted.")
            continue
        if only_target or (changed and table not in INSERT_ORDER):
            unexpected.append(table)
        if only_source:
            if table not in INSERT_ORDER:
                unexpected.append(table)
            else:
                inserts[table] = only_source
    if unexpected:
        names = ", ".join(sorted(set(unexpected)))
        raise ReconciliationError(f"Unexpected differences in {names}.")
    stock = _changed_stock(source, target)
    return {"inserts": inserts, "stock": stock}


def _changed_stock(source: psycopg.Connection, target: psycopg.Connection) -> list[str]:
    left = _hashes(source, "daily_stock")
    right = _hashes(target, "daily_stock")
    return sorted(key for key in set(left) & set(right) if left[key] != right[key])


def apply_reconciliation(source: psycopg.Connection, target: psycopg.Connection) -> Counter:
    planned = plan_reconciliation(source, target)
    counts: Counter = Counter()
    for table in INSERT_ORDER:
        ids = planned["inserts"].get(table, [])
        if not ids:
            continue
        counts[table] = _insert_missing(source, target, table, ids)
    if planned["stock"]:
        counts["daily_stock"] = _update_stock(source, target, planned["stock"])
    target.commit()
    return counts


def _insert_missing(
    source: psycopg.Connection,
    target: psycopg.Connection,
    table: str,
    ids: list[str],
) -> int:
    columns = _columns(source, table)
    quoted = ", ".join(f'"{name}"' for name in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    rows = source.execute(
        f'SELECT {quoted} FROM public."{table}" WHERE id = ANY(%s::uuid[])',
        (ids,),
    ).fetchall()
    if len(rows) != len(ids):
        raise ReconciliationError(f"Missing source rows for {table}.")
    with target.cursor() as cursor:
        cursor.executemany(
            f'INSERT INTO public."{table}" ({quoted}) VALUES ({placeholders})',
            rows,
        )
    return len(rows)


def _update_stock(source: psycopg.Connection, target: psycopg.Connection, ids: list[str]) -> int:
    columns = ", ".join(f'"{name}"' for name in STOCK_COLUMNS)
    rows = source.execute(
        f"SELECT id::text, {columns} FROM public.daily_stock WHERE id = ANY(%s::uuid[])",
        (ids,),
    ).fetchall()
    if len(rows) != len(ids):
        raise ReconciliationError("Missing source stock rows.")
    assignments = ", ".join(f'"{name}" = %s' for name in STOCK_COLUMNS)
    with target.cursor() as cursor:
        cursor.executemany(
            f"UPDATE public.daily_stock SET {assignments} WHERE id = %s::uuid",
            [(*row[1:], row[0]) for row in rows],
        )
    return len(rows)
