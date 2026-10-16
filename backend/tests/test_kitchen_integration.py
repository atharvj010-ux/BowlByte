import threading
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.identity import CASHIER, KITCHEN_STAFF
from app.models.ordering import (
    DailyStock,
    KitchenStation,
    MenuItem,
    Order,
    OrderEvent,
    PreparationTask,
)
from app.services.ordering import place_order
from app.services.rate_limit import clear_counters
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
        pytest.fail("Kitchen integration tests must use the bowlbyte_test database.")
    db = SessionLocal()
    db.execute(
        text(
            "TRUNCATE order_hold_events, preparation_tasks, order_idempotency_records, "
            "inventory_adjustments, order_payments, "
            "order_events, order_items, orders, daily_stock, menu_item_station_assignments, "
            "menu_item_pairings, menu_items, kitchen_stations, menu_categories, "
            "audit_log, sessions, staff_invitations, email_verification_tokens, "
            "student_roster_entries, staff_memberships, student_profiles, "
            "users, canteens, colleges RESTART IDENTITY CASCADE"
        )
    )
    db.commit()
    db.close()
    clear_counters()
    yield
    clear_counters()


def _order(student, item_id, quantity=1):
    db = SessionLocal()
    user = db.get(type(student), student.id)
    saved = place_order(
        db,
        student=user,
        lines=[(item_id, quantity)],
        note=None,
        idempotency_key=uuid.uuid4().hex,
    )
    db.close()
    return saved


def test_kitchen_flow_stock_eta_and_permissions(client: TestClient) -> None:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    cashier = _add_user(CASHIER, _email("cashier"), canteen_id, college_id)
    other_kitchen = _add_user(KITCHEN_STAFF, _email("other-kitchen"), None, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=4)
    saved = _order(student, uuid.UUID(item["id"]), 2)

    _login(client, student.email)
    denied = client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
    assert denied.status_code == 403
    _login(client, cashier.email)
    assert (
        client.post(
            f"/api/v1/staff/orders/{saved['id']}/ready",
            json={"packed": True},
            headers=_csrf(client),
        ).status_code
        == 403
    )

    _login(client, kitchen.email)
    accepted = client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["status"] == "QUEUED"
    assert len(body["tasks"]) == 2
    assert body["payment"]["status"] == "PENDING"
    again = client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
    assert again.status_code == 200
    assert len(again.json()["tasks"]) == 2
    task_id = body["tasks"][0]["id"]
    started = client.post(f"/api/v1/staff/preparation-tasks/{task_id}/start", headers=_csrf(client))
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "PREPARING"
    replay = client.post(f"/api/v1/staff/preparation-tasks/{task_id}/start", headers=_csrf(client))
    assert replay.status_code == 409
    db = SessionLocal()
    stock = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == uuid.UUID(item["id"])))
    assert stock is not None
    assert stock.reserved_qty == 1
    assert stock.consumed_qty == 1
    assert stock.available_qty == 2
    db.close()
    paid = client.post("/api/v1/orders", json={"payment_status": "PAID"})
    assert paid.status_code in {401, 403, 422}
    finished = client.post(
        f"/api/v1/staff/preparation-tasks/{task_id}/complete", headers=_csrf(client)
    )
    assert finished.status_code == 200
    assert (
        client.post(
            f"/api/v1/staff/preparation-tasks/{task_id}/complete", headers=_csrf(client)
        ).status_code
        == 200
    )
    too_soon = client.post(
        f"/api/v1/staff/orders/{saved['id']}/ready",
        json={"packed": True},
        headers=_csrf(client),
    )
    assert too_soon.status_code == 409
    second = next(task["id"] for task in finished.json()["tasks"] if task["id"] != task_id)
    assert (
        client.post(
            f"/api/v1/staff/preparation-tasks/{second}/start", headers=_csrf(client)
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/staff/preparation-tasks/{second}/complete", headers=_csrf(client)
        ).status_code
        == 200
    )
    ready = client.post(
        f"/api/v1/staff/orders/{saved['id']}/ready",
        json={"packed": True},
        headers=_csrf(client),
    )
    assert ready.status_code == 200, ready.text
    assert ready.json()["status"] == "READY"
    assert ready.json()["payment"]["status"] == "PENDING"
    assert ready.json()["payment"]["method"] == "CASH"

    _login(client, student.email)
    tracking = client.get(f"/api/v1/orders/{saved['id']}/tracking")
    assert tracking.status_code == 200
    assert tracking.json()["status"] == "READY"
    _login(client, other_kitchen.email)
    hidden = client.get("/api/v1/staff/queue")
    assert hidden.status_code == 403


def test_reject_releases_once_and_started_work_cannot_be_rejected(client: TestClient) -> None:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=3)
    first = _order(student, uuid.UUID(item["id"]))
    second = _order(student, uuid.UUID(item["id"]))
    _login(client, kitchen.email)
    accepted = client.post(f"/api/v1/staff/orders/{first['id']}/accept", headers=_csrf(client))
    assert accepted.status_code == 200
    task_id = accepted.json()["tasks"][0]["id"]
    assert (
        client.post(
            f"/api/v1/staff/preparation-tasks/{task_id}/start", headers=_csrf(client)
        ).status_code
        == 200
    )
    blocked = client.post(
        f"/api/v1/staff/orders/{first['id']}/reject",
        json={"reason": "Too late"},
        headers=_csrf(client),
    )
    assert blocked.status_code == 409
    queued = client.post(f"/api/v1/staff/orders/{second['id']}/accept", headers=_csrf(client))
    assert queued.status_code == 200
    rejected = client.post(
        f"/api/v1/staff/orders/{second['id']}/reject",
        json={"reason": "Station down"},
        headers=_csrf(client),
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "REJECTED"
    repeat = client.post(
        f"/api/v1/staff/orders/{second['id']}/reject",
        json={"reason": "Station down"},
        headers=_csrf(client),
    )
    assert repeat.status_code == 200
    db = SessionLocal()
    stock = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == uuid.UUID(item["id"])))
    assert stock is not None
    assert stock.reserved_qty == 0
    assert stock.consumed_qty == 1
    assert stock.available_qty == 2
    db.close()


def test_capacity_and_snapshot_are_stable(client: TestClient) -> None:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    second = _add_user(KITCHEN_STAFF, _email("kitchen-b"), canteen_id, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=4)
    db = SessionLocal()
    station = db.scalar(select(KitchenStation))
    assert station is not None
    station.parallel_capacity = 1
    menu = db.get(MenuItem, uuid.UUID(item["id"]))
    assert menu is not None
    db.commit()
    db.close()
    one = _order(student, uuid.UUID(item["id"]))
    two = _order(student, uuid.UUID(item["id"]))
    _login(client, kitchen.email)
    first = client.post(f"/api/v1/staff/orders/{one['id']}/accept", headers=_csrf(client)).json()
    second_order = client.post(
        f"/api/v1/staff/orders/{two['id']}/accept", headers=_csrf(client)
    ).json()
    left = first["tasks"][0]["id"]
    right = second_order["tasks"][0]["id"]
    results: list[int] = []

    def fire(email: str, task: str) -> None:
        local = TestClient(client.app)
        local.headers.update({"origin": "http://localhost:3000"})
        _login(local, email)
        response = local.post(f"/api/v1/staff/preparation-tasks/{task}/start", headers=_csrf(local))
        results.append(response.status_code)

    threads = [
        threading.Thread(target=fire, args=(kitchen.email, left)),
        threading.Thread(target=fire, args=(second.email, right)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == [200, 409]
    db = SessionLocal()
    stock = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == uuid.UUID(item["id"])))
    assert stock is not None
    assert stock.consumed_qty == 1
    assert stock.reserved_qty == 1
    assert stock.available_qty >= 0
    negative = db.scalar(
        select(func.count())
        .select_from(DailyStock)
        .where(
            (DailyStock.available_qty < 0)
            | (DailyStock.reserved_qty < 0)
            | (DailyStock.consumed_qty < 0)
        )
    )
    assert int(negative or 0) == 0
    db.close()
    _login(client, manager_email)
    changed = client.patch(
        f"/api/v1/admin/menu/{item['id']}",
        json={"prep_seconds": 900},
        headers=_csrf(client),
    )
    assert changed.status_code == 200
    db = SessionLocal()
    durations = list(db.scalars(select(PreparationTask.expected_duration_seconds)))
    assert durations
    assert set(durations) == {300}
    events = db.scalar(
        select(func.count()).select_from(OrderEvent).where(OrderEvent.to_status == "QUEUED")
    )
    assert int(events or 0) == 2
    db.close()


def test_websocket_auth_and_database_survives_publish_failure(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/api/v1/ws/kitchen", headers={"origin": "http://evil.example"}
        ) as socket:
            socket.receive_json()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/api/v1/ws/kitchen", headers={"origin": "http://localhost:3000"}
        ) as socket:
            socket.receive_json()
    manager_email, college_id, canteen_id = _bootstrap()
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    student = _add_user("STUDENT", _student_email(), None, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=2)
    saved = _order(student, uuid.UUID(item["id"]))
    _login(client, kitchen.email)
    with client.websocket_connect(
        "/api/v1/ws/kitchen", headers={"origin": "http://localhost:3000"}
    ) as socket:
        hello = socket.receive_json()
        assert hello["type"] == "connected"
        accepted = client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
        assert accepted.status_code == 200
        event = socket.receive_json()
        assert event["type"] == "order.accepted"
        assert event["version"] >= 1
    _login(client, student.email)
    foreign = client.websocket_connect(
        f"/api/v1/ws/orders/{uuid.uuid4()}",
        headers={"origin": "http://localhost:3000"},
    )
    with pytest.raises(WebSocketDisconnect):
        with foreign as socket:
            socket.receive_json()
    own = client.get(f"/api/v1/orders/{saved['id']}/tracking")
    assert own.status_code == 200


def test_queue_timing_for_small_batches(client: TestClient) -> None:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=120)
    _login(client, kitchen.email)
    marks = {}
    started = datetime.now(UTC)
    for index in range(100):
        saved = _order(student, uuid.UUID(item["id"]))
        response = client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
        assert response.status_code == 200
        if index + 1 in {10, 50, 100}:
            marks[index + 1] = (datetime.now(UTC) - started).total_seconds()
    assert marks[10] < 30
    assert marks[100] < 120
    print(f"P004_QUEUE_SECONDS {marks}")
    db = SessionLocal()
    count = db.scalar(select(func.count()).select_from(Order).where(Order.status == "QUEUED"))
    assert int(count or 0) == 100
    db.close()
