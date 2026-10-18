"""Pickup holds, proxy labels, and queue locking on real PostgreSQL."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.identity import KITCHEN_STAFF
from app.models.intelligence import FoodWasteRecord
from app.models.ordering import DailyStock, Order, OrderHoldEvent, OrderPayment
from app.services.pickup import issue_credential
from app.services.rate_limit import clear_counters
from app.services.unclaimed import sweep_pickup_holds
from tests.test_ordering_integration import (
    _add_user,
    _bootstrap,
    _csrf,
    _email,
    _login,
    _sellable,
    _student_email,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def reset_tables() -> None:
    database = get_settings().database_url.rsplit("/", 1)[-1].split("?")[0]
    if database != "bowlbyte_test":
        pytest.fail("P007 integration tests must use the bowlbyte_test database.")
    db = SessionLocal()
    db.execute(
        text(
            "TRUNCATE order_hold_events, preparation_tasks, order_idempotency_records, "
            "inventory_adjustments, order_payments, order_events, order_items, orders, "
            "daily_stock, menu_item_station_assignments, menu_item_pairings, "
            "menu_items, kitchen_stations, "
            "menu_categories, audit_log, sessions, staff_invitations, email_verification_tokens, "
            "student_roster_entries, staff_memberships, student_profiles, users, canteens, "
            "colleges RESTART IDENTITY CASCADE"
        )
    )
    db.commit()
    db.close()
    clear_counters()
    yield
    clear_counters()


def _ready(client: TestClient) -> tuple[str, object, object]:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=8)
    _login(client, student.email)
    placed = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 1}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert placed.status_code == 201, placed.text
    order_id = placed.json()["id"]
    _login(client, kitchen.email)
    accepted = client.post(f"/api/v1/staff/orders/{order_id}/accept", headers=_csrf(client))
    assert accepted.status_code == 200, accepted.text
    task_id = accepted.json()["tasks"][0]["id"]
    for step in ("start", "complete"):
        done = client.post(
            f"/api/v1/staff/preparation-tasks/{task_id}/{step}", headers=_csrf(client)
        )
        assert done.status_code == 200, done.text
    ready = client.post(
        f"/api/v1/staff/orders/{order_id}/ready",
        json={"packed": True},
        headers=_csrf(client),
    )
    assert ready.status_code == 200, ready.text
    return order_id, student, manager_email


def test_expired_hold_blocks_pickup_without_touching_payment_or_stock(client: TestClient) -> None:
    order_id, student, manager_email = _ready(client)
    db = SessionLocal()
    order = db.get(Order, uuid.UUID(order_id))
    assert order is not None
    assert order.pickup_hold_until is not None
    assert order.ready_at is not None
    stock_before = db.scalar(select(func.sum(DailyStock.available_qty)))
    order.pickup_hold_until = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    result = sweep_pickup_holds(db, datetime.now(UTC))
    db.close()
    assert result["unclaimed"] == 1

    db = SessionLocal()
    order = db.get(Order, uuid.UUID(order_id))
    payment = db.scalar(select(OrderPayment).where(OrderPayment.order_id == order.id))
    waste = db.scalar(select(func.count()).select_from(FoodWasteRecord))
    stock_after = db.scalar(select(func.sum(DailyStock.available_qty)))
    events = list(db.scalars(select(OrderHoldEvent.action)))
    assert order.status == "UNCLAIMED"
    assert order.ready_at is not None
    assert payment.status == "PENDING"
    assert int(waste or 0) == 0
    assert stock_after == stock_before
    assert "UNCLAIMED" in events
    user = db.get(type(student), student.id)
    with pytest.raises(Exception) as caught:
        issue_credential(db, student=user, order_id=order.id)
    assert getattr(caught.value, "code", "") == "PICKUP_HOLD_EXPIRED"
    db.rollback()
    db.close()
    db = SessionLocal()
    again = sweep_pickup_holds(db, datetime.now(UTC))
    db.close()
    assert again["unclaimed"] == 0

    _login(client, manager_email)
    extended = client.post(
        f"/api/v1/admin/orders/{order_id}/hold/extend",
        json={"minutes": 30, "note": "Student is at the counter."},
        headers=_csrf(client),
    )
    assert extended.status_code == 200, extended.text
    assert extended.json()["status"] == "READY"
    denied = client.post(
        f"/api/v1/admin/orders/{order_id}/hold/extend",
        json={"minutes": 30, "note": "Again"},
        headers=_csrf(client),
    )
    assert denied.status_code == 409
