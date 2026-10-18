"""Time sequential place-and-accept on bowlbyte_test.

Single-process measurement. Not a production capacity figure.
Refuses to run unless the database name is bowlbyte_test.
"""

import os
import time
import uuid

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://bowlbyte:bowlbyte@127.0.0.1:5433/bowlbyte_test"
)
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/0")
os.environ.setdefault("COLLEGE_ELIGIBILITY_MODE", "disabled")

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.main import create_app
from app.models.identity import KITCHEN_STAFF
from app.services.rate_limit import clear_counters
from tests.test_kitchen_integration import _order
from tests.test_ordering_integration import _add_user, _bootstrap, _csrf, _email, _login, _sellable


def main() -> None:
    database = get_settings().database_url.rsplit("/", 1)[-1].split("?")[0]
    if database != "bowlbyte_test":
        raise SystemExit(f"refusing to benchmark {database}")
    counts = [int(part) for part in os.environ.get("BENCH_COUNTS", "10,50,100").split(",")]
    db = SessionLocal()
    db.execute(
        text(
            "TRUNCATE order_hold_events, preparation_tasks, order_idempotency_records, "
            "inventory_adjustments, "
            "order_payments, order_events, order_items, orders, daily_stock, "
            "menu_item_station_assignments, menu_item_pairings, menu_items, "
            "kitchen_stations, menu_categories, "
            "audit_log, sessions, staff_invitations, email_verification_tokens, "
            "student_roster_entries, staff_memberships, student_profiles, "
            "users, canteens, colleges RESTART IDENTITY CASCADE"
        )
    )
    db.commit()
    db.close()
    clear_counters()
    app = create_app()
    with TestClient(app) as client:
        client.headers.update({"origin": "http://localhost:3000"})
        manager_email, college_id, canteen_id = _bootstrap()
        student = _add_user("STUDENT", _email("bench-student"), None, college_id)
        kitchen = _add_user(KITCHEN_STAFF, _email("bench-kitchen"), canteen_id, college_id)
        _login(client, manager_email)
        item = _sellable(client, stock=500)
        _login(client, kitchen.email)
        headers = _csrf(client)
        for count in counts:
            started = time.perf_counter()
            errors = 0
            for _ in range(count):
                saved = _order(student, uuid.UUID(item["id"]), 1)
                accepted = client.post(
                    f"/api/v1/staff/orders/{saved['id']}/accept", headers=headers
                )
                if accepted.status_code != 200:
                    errors += 1
            elapsed = time.perf_counter() - started
            print(
                f"count={count} seconds={elapsed:.3f} "
                f"per_order_ms={elapsed / count * 1000:.1f} errors={errors}",
                flush=True,
            )


if __name__ == "__main__":
    main()
