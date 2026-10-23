import threading
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.identity import (
    ACTIVE,
    CASHIER,
    KITCHEN_STAFF,
    MEMBERSHIP_ACTIVE,
    Canteen,
    StaffMembership,
    User,
)
from app.models.ordering import DailyStock, MenuItem, Order, OrderItem, OrderPayment
from app.services.identity import bootstrap_first_manager, ensure_college
from app.services.ordering import place_order, service_today
from app.services.rate_limit import clear_counters
from tests.disposable_guard import require_disposable_database

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def reset_tables() -> None:
    require_disposable_database()
    get_settings()
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


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@staff.bowlbyte.edu"


def _student_email() -> str:
    return f"student-{uuid.uuid4().hex[:8]}@student.bowlbyte.edu"


def _csrf(client: TestClient) -> dict[str, str]:
    token = client.cookies.get("bowlbyte_csrf")
    assert token
    return {"x-csrf-token": token}


def _login(client: TestClient, email: str) -> None:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text


def _add_user(role: str, email: str, canteen_id, college_id) -> User:
    db = SessionLocal()
    user = User(
        college_id=college_id,
        full_name=role.title(),
        email=email,
        password_hash=hash_password(PASSWORD),
        role=role,
        status=ACTIVE,
        email_verified_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    if canteen_id is not None and role != "STUDENT":
        db.add(
            StaffMembership(
                user_id=user.id,
                canteen_id=canteen_id,
                role=role,
                status=MEMBERSHIP_ACTIVE,
            )
        )
    db.commit()
    db.refresh(user)
    db.close()
    return user


def _bootstrap() -> tuple[str, object, object]:
    email = _email("manager")
    db = SessionLocal()
    manager = bootstrap_first_manager(
        db,
        email=email,
        full_name="Pilot Manager",
        password=PASSWORD,
    )
    college_id = manager.college_id
    canteen = db.scalar(select(Canteen).where(Canteen.slug == get_settings().canteen_slug))
    assert canteen is not None
    canteen_id = canteen.id
    db.close()
    return email, college_id, canteen_id


def _sellable(client: TestClient, stock: int = 5) -> dict:
    created = client.post(
        "/api/v1/admin/categories",
        json={"name": f"Snacks {uuid.uuid4().hex[:4]}"},
        headers=_csrf(client),
    )
    assert created.status_code == 201, created.text
    station = client.post(
        "/api/v1/admin/stations",
        json={"name": f"Sandwich {uuid.uuid4().hex[:4]}", "parallel_capacity": 2},
        headers=_csrf(client),
    )
    assert station.status_code == 201, station.text
    item = client.post(
        "/api/v1/admin/menu",
        json={
            "category_id": created.json()["id"],
            "station_id": station.json()["id"],
            "name": f"Veg Sandwich {uuid.uuid4().hex[:4]}",
            "description": "Toasted vegetables",
            "price_paise": 4000,
            "prep_seconds": 300,
            "initial_available_qty": stock,
        },
        headers=_csrf(client),
    )
    assert item.status_code == 201, item.text
    return item.json()


def test_student_browses_and_manager_edits_menu(client: TestClient) -> None:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    _login(client, manager_email)
    item = _sellable(client)
    edited = client.patch(
        f"/api/v1/admin/menu/{item['id']}",
        json={"description": "Extra mint", "price_paise": 4500},
        headers=_csrf(client),
    )
    assert edited.status_code == 200
    assert edited.json()["price_paise"] == 4500

    _login(client, student.email)
    menu = client.get("/api/v1/menu/items")
    assert menu.status_code == 200
    assert menu.json()["items"][0]["price_paise"] == 4500
    health = client.get("/api/v1/health")
    assert health.status_code == 200

    _login(client, kitchen.email)
    denied = client.patch(
        f"/api/v1/admin/menu/{item['id']}",
        json={"price_paise": 100},
        headers=_csrf(client),
    )
    assert denied.status_code == 403

    _login(client, student.email)
    student_edit = client.patch(
        f"/api/v1/admin/menu/{item['id']}",
        json={"price_paise": 100},
        headers=_csrf(client),
    )
    assert student_edit.status_code == 403


def test_order_rules_stock_snapshots_and_csrf(client: TestClient) -> None:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    other = _add_user("STUDENT", _student_email(), None, college_id)
    kitchen = _add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id)
    cashier = _add_user(CASHIER, _email("cashier"), canteen_id, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=2)
    db = SessionLocal()
    college = ensure_college(db)
    other_canteen = Canteen(
        college_id=college.id, name="Other", slug=f"other-{uuid.uuid4().hex[:6]}"
    )
    db.add(other_canteen)
    db.commit()
    other_id = other_canteen.id
    db.close()
    outside = _add_user(KITCHEN_STAFF, _email("outsider"), other_id, college_id)

    _login(client, student.email)
    negative = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": -1}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert negative.status_code == 422
    # Shelf status is manager-owned: only Out of stock refuses checkout.
    db = SessionLocal()
    shelf = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == uuid.UUID(item["id"])))
    assert shelf is not None
    shelf.available_qty = 0
    db.commit()
    db.close()
    sold_out = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 1}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert sold_out.status_code == 409
    db = SessionLocal()
    shelf = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == uuid.UUID(item["id"])))
    assert shelf is not None
    shelf.available_qty = 2
    db.commit()
    db.close()
    db = SessionLocal()
    from app.models.ordering import KitchenStation, MenuCategory

    foreign_category = MenuCategory(canteen_id=other_id, name="Other Snacks", sort_order=0)
    foreign_station = KitchenStation(
        canteen_id=other_id,
        name="Other Station",
        parallel_capacity=1,
    )
    db.add_all([foreign_category, foreign_station])
    db.flush()
    foreign_item = MenuItem(
        canteen_id=other_id,
        category_id=foreign_category.id,
        name="Other Canteen Maggi",
        description="Not for this pilot",
        price_paise=1000,
        prep_seconds=120,
        is_available=True,
    )
    db.add(foreign_item)
    db.flush()
    db.add(
        DailyStock(
            menu_item_id=foreign_item.id,
            service_date=service_today(),
            available_qty=5,
        )
    )
    db.commit()
    foreign_item_id = foreign_item.id
    db.close()
    other_canteen_order = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": str(foreign_item_id), "quantity": 1}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert other_canteen_order.status_code == 400
    missing = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": str(uuid.uuid4()), "quantity": 1}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert missing.status_code == 400
    forged = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 1, "price_paise": 1}],
            "idempotency_key": uuid.uuid4().hex,
            "payment_status": "PAID",
        },
        headers=_csrf(client),
    )
    assert forged.status_code == 422

    key = uuid.uuid4().hex
    origin = client.headers.pop("origin")
    no_origin = client.post(
        "/api/v1/orders",
        json={"items": [{"menu_item_id": item["id"], "quantity": 1}], "idempotency_key": key},
    )
    client.headers["origin"] = origin
    assert no_origin.status_code == 403
    no_csrf = client.post(
        "/api/v1/orders",
        json={"items": [{"menu_item_id": item["id"], "quantity": 1}], "idempotency_key": key},
    )
    assert no_csrf.status_code == 403

    placed = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 1}],
            "note": "No onion",
            "idempotency_key": key,
        },
        headers=_csrf(client),
    )
    assert placed.status_code == 201, placed.text
    body = placed.json()
    assert body["status"] == "PLACED"
    assert body["payment"] == {
        "method": "CASH",
        "status": "PENDING",
        "amount_paise": 4000,
        "paid_at": None,
    }
    assert body["total_paise"] == 4000
    assert body["items"][0]["unit_price_paise"] == 4000
    assert isinstance(body["total_paise"], int)

    replay = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 1}],
            "note": "No onion",
            "idempotency_key": key,
        },
        headers=_csrf(client),
    )
    assert replay.status_code == 201
    assert replay.json()["id"] == body["id"]
    changed = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 2}],
            "note": "No onion",
            "idempotency_key": key,
        },
        headers=_csrf(client),
    )
    assert changed.status_code == 409

    _login(client, manager_email)
    client.patch(
        f"/api/v1/admin/menu/{item['id']}",
        json={"price_paise": 9000, "is_available": False},
        headers=_csrf(client),
    )
    db = SessionLocal()
    snapshot = db.scalar(select(OrderItem).where(OrderItem.order_id == uuid.UUID(body["id"])))
    assert snapshot is not None
    assert snapshot.unit_price_paise == 4000
    assert snapshot.item_name.startswith("Veg Sandwich")
    db.close()

    _login(client, student.email)
    unavailable = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 1}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert unavailable.status_code == 400
    paid = client.post(f"/api/v1/orders/{body['id']}/payment", headers=_csrf(client))
    ready = client.post(f"/api/v1/orders/{body['id']}/ready", headers=_csrf(client))
    assert paid.status_code == 404
    assert ready.status_code == 404

    _login(client, other.email)
    hidden = client.get(f"/api/v1/orders/{body['id']}")
    assert hidden.status_code == 404
    stolen = client.post(f"/api/v1/orders/{body['id']}/cancel", headers=_csrf(client))
    assert stolen.status_code == 404

    _login(client, kitchen.email)
    queue = client.get("/api/v1/staff/orders")
    assert queue.status_code == 200
    assert queue.json()["orders"][0]["ticket_number"] == body["ticket_number"]
    assert queue.json()["orders"][0]["payment"]["status"] == "PENDING"
    _login(client, outside.email)
    foreign = client.get("/api/v1/staff/orders")
    assert foreign.status_code == 200
    assert foreign.json()["orders"] == []
    _login(client, cashier.email)
    cashier_queue = client.get("/api/v1/staff/orders")
    assert cashier_queue.status_code == 403

    db = SessionLocal()
    other_manager = User(
        college_id=college_id,
        full_name="Other Manager",
        email=_email("other-manager"),
        password_hash=hash_password(PASSWORD),
        role="CANTEEN_MANAGER",
        status=ACTIVE,
        email_verified_at=datetime.now(UTC),
    )
    db.add(other_manager)
    db.flush()
    db.add(
        StaffMembership(
            user_id=other_manager.id,
            canteen_id=other_id,
            role="CANTEEN_MANAGER",
            status=MEMBERSHIP_ACTIVE,
        )
    )
    db.commit()
    other_manager_email = other_manager.email
    db.close()
    _login(client, other_manager_email)
    foreign_menu = client.get("/api/v1/admin/menu")
    assert foreign_menu.status_code == 200
    foreign_ids = {row["id"] for row in foreign_menu.json()["items"]}
    assert item["id"] not in foreign_ids
    assert str(foreign_item_id) in foreign_ids
    denied_edit = client.patch(
        f"/api/v1/admin/menu/{item['id']}",
        json={"price_paise": 100},
        headers=_csrf(client),
    )
    assert denied_edit.status_code == 404
    foreign_orders = client.get("/api/v1/admin/orders")
    assert foreign_orders.json()["orders"] == []
    assert foreign_orders.json()["totals"]["cash_collected_paise"] is None


def test_cancellation_restores_stock_once(client: TestClient) -> None:
    manager_email, college_id, _canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=3)
    _login(client, student.email)
    placed = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": item["id"], "quantity": 2}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert placed.status_code == 201
    order_id = placed.json()["id"]
    first = client.post(f"/api/v1/orders/{order_id}/cancel", headers=_csrf(client))
    second = client.post(f"/api/v1/orders/{order_id}/cancel", headers=_csrf(client))
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["status"] == "CANCELLED"
    assert second.json()["status"] == "CANCELLED"
    history = client.get("/api/v1/orders")
    assert history.json()["orders"][0]["status"] == "CANCELLED"
    _login(client, manager_email)
    stock = client.get("/api/v1/admin/stock")
    row = next(row for row in stock.json()["rows"] if row["menu_item_id"] == item["id"])
    assert row["available_qty"] == 3
    assert row["reserved_qty"] == 0
    kitchen_view = client.get("/api/v1/staff/orders")
    assert kitchen_view.status_code == 403


def test_oversell_and_duplicate_retries(client: TestClient) -> None:
    _manager_email, college_id, canteen_id = _bootstrap()
    db = SessionLocal()
    canteen = db.get(Canteen, canteen_id)
    assert canteen is not None
    from app.models.ordering import KitchenStation, MenuCategory, MenuItemStationAssignment

    category = MenuCategory(canteen_id=canteen.id, name="Snacks", sort_order=0)
    station = KitchenStation(canteen_id=canteen.id, name="Sandwich Station", parallel_capacity=2)
    db.add_all([category, station])
    db.flush()
    item = MenuItem(
        canteen_id=canteen.id,
        category_id=category.id,
        name="Last Samosa",
        description="One portion",
        price_paise=2000,
        prep_seconds=240,
    )
    db.add(item)
    db.flush()
    db.add(MenuItemStationAssignment(menu_item_id=item.id, station_id=station.id))
    db.add(DailyStock(menu_item_id=item.id, service_date=service_today(), available_qty=1))
    students = []
    for _ in range(2):
        student = User(
            college_id=college_id,
            full_name="Buyer",
            email=_student_email(),
            password_hash=hash_password(PASSWORD),
            role="STUDENT",
            status=ACTIVE,
            email_verified_at=datetime.now(UTC),
        )
        db.add(student)
        students.append(student)
    db.commit()
    item_id = item.id
    student_ids = [student.id for student in students]
    same = students[0].id
    db.close()

    results: list[str] = []

    def buy(student_id, key: str) -> None:
        session = SessionLocal()
        try:
            buyer = session.get(User, student_id)
            assert buyer is not None
            place_order(
                session,
                student=buyer,
                lines=[(item_id, 1)],
                note=None,
                idempotency_key=key,
            )
            results.append("ok")
        except Exception as exc:  # noqa: BLE001 - the test records the failure class
            results.append(type(exc).__name__)
        finally:
            session.close()

    threads = [
        threading.Thread(target=buy, args=(student_ids[0], uuid.uuid4().hex)),
        threading.Thread(target=buy, args=(student_ids[1], uuid.uuid4().hex)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    # Shelf status is manager-owned: qty=1 (Few left) still allows both buyers.
    assert results.count("ok") == 2
    db = SessionLocal()
    stock = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == item_id))
    assert stock is not None
    assert stock.available_qty == 1
    assert stock.reserved_qty == 2
    orders = db.scalars(select(Order)).all()
    assert len(orders) == 2
    payment = db.scalar(select(OrderPayment))
    assert payment is not None
    assert payment.status == "PENDING"
    assert payment.method == "CASH"
    db.close()

    # Sold out blocks every buyer.
    db = SessionLocal()
    stock = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == item_id))
    assert stock is not None
    stock.available_qty = 0
    db.commit()
    db.close()
    blocked: list[str] = []

    def try_sold_out(student_id, key: str) -> None:
        session = SessionLocal()
        try:
            buyer = session.get(User, student_id)
            assert buyer is not None
            place_order(
                session,
                student=buyer,
                lines=[(item_id, 1)],
                note=None,
                idempotency_key=key,
            )
            blocked.append("ok")
        except Exception as exc:  # noqa: BLE001
            blocked.append(type(exc).__name__)
        finally:
            session.close()

    sold_threads = [
        threading.Thread(target=try_sold_out, args=(student_ids[0], uuid.uuid4().hex)),
        threading.Thread(target=try_sold_out, args=(student_ids[1], uuid.uuid4().hex)),
    ]
    for thread in sold_threads:
        thread.start()
    for thread in sold_threads:
        thread.join()
    assert blocked.count("ok") == 0

    raced: list[str] = []

    def repeat() -> None:
        session = SessionLocal()
        try:
            buyer = session.get(User, same)
            assert buyer is not None
            saved = place_order(
                session,
                student=buyer,
                lines=[(item_id, 1)],
                note="later",
                idempotency_key="same-key-same-key",
            )
            raced.append(saved["id"])
        finally:
            session.close()

    # Restock, then race the same idempotency key — only one order may be inserted.
    db = SessionLocal()
    stock = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == item_id))
    assert stock is not None
    stock.available_qty = 1
    db.commit()
    db.close()
    pair = [threading.Thread(target=repeat), threading.Thread(target=repeat)]
    for thread in pair:
        thread.start()
    for thread in pair:
        thread.join()
    assert len(set(raced)) == 1
    db = SessionLocal()
    later = db.scalars(select(Order).where(Order.note == "later")).all()
    assert len(later) == 1
    db.close()


def test_post_commit_disconnect_still_returns_the_saved_order(client: TestClient) -> None:
    from sqlalchemy.exc import OperationalError

    import app.services.ordering as ordering

    manager_email, college_id, _canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    _login(client, manager_email)
    item = _sellable(client, stock=2)
    _login(client, student.email)
    original = ordering._payload_after_commit

    def drop_connection(db, order):
        def refresh(_instance, *_args, **_kwargs):
            raise OperationalError("SELECT", {}, Exception("connection closed"))

        db.refresh = refresh
        return original(db, order)

    ordering._payload_after_commit = drop_connection
    try:
        response = client.post(
            "/api/v1/orders",
            json={
                "items": [{"menu_item_id": item["id"], "quantity": 1}],
                "note": "pooler",
                "idempotency_key": "pooler-drop-0001",
            },
            headers=_csrf(client),
        )
    finally:
        ordering._payload_after_commit = original
    assert response.status_code == 201, response.text
    order_id = response.json()["id"]
    db = SessionLocal()
    orders = db.scalars(select(Order).where(Order.note == "pooler")).all()
    assert len(orders) == 1
    assert str(orders[0].id) == order_id
    items = db.scalars(select(OrderItem).where(OrderItem.order_id == orders[0].id)).all()
    assert len(items) == 1
    payments = db.scalars(select(OrderPayment)).all()
    assert len(payments) == 1
    stock = db.scalar(select(DailyStock).where(DailyStock.menu_item_id == item["id"]))
    assert stock is not None
    assert stock.available_qty == 2
    assert stock.reserved_qty == 1
    db.close()


def test_expired_session_still_blocked_and_ready_endpoint(client: TestClient) -> None:
    response = client.get("/api/v1/ready")
    assert response.status_code == 200
    stale = client.get("/api/v1/orders")
    assert stale.status_code == 401
    too_much = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": str(uuid.uuid4()), "quantity": 99}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers={"x-csrf-token": "x" * 16},
    )
    assert too_much.status_code in {401, 403, 422}


def test_nutrition_requires_a_source_and_pairings_stay_in_stock(client: TestClient) -> None:
    manager_email, college_id, _canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    _login(client, manager_email)
    fries = _sellable(client, stock=4)
    drink = _sellable(client, stock=0)
    coke = _sellable(client, stock=3)
    bare = client.patch(
        f"/api/v1/admin/menu/{fries['id']}",
        json={"calories_kcal": 280},
        headers=_csrf(client),
    )
    assert bare.status_code == 422
    labeled = client.patch(
        f"/api/v1/admin/menu/{fries['id']}",
        json={
            "name": "Salted Fries",
            "calories_kcal": 280,
            "nutrition_source": "ILLUSTRATIVE",
            "serving_size_description": "one serving",
            "nutrition_reference": "Demo kitchen card, not a lab assay",
        },
        headers=_csrf(client),
    )
    assert labeled.status_code == 200, labeled.text
    assert labeled.json()["calories_kcal"] == 280
    assert labeled.json()["nutrition_source"] == "ILLUSTRATIVE"
    self_pair = client.post(
        f"/api/v1/admin/menu/{fries['id']}/pairings",
        json={"suggested_item_id": fries["id"]},
        headers=_csrf(client),
    )
    assert self_pair.status_code == 422
    hidden = client.post(
        f"/api/v1/admin/menu/{fries['id']}/pairings",
        json={"suggested_item_id": drink["id"], "priority": 1},
        headers=_csrf(client),
    )
    assert hidden.status_code == 201, hidden.text
    shown = client.post(
        f"/api/v1/admin/menu/{fries['id']}/pairings",
        json={"suggested_item_id": coke["id"], "priority": 5},
        headers=_csrf(client),
    )
    assert shown.status_code == 201, shown.text
    again = client.post(
        f"/api/v1/admin/menu/{fries['id']}/pairings",
        json={"suggested_item_id": coke["id"]},
        headers=_csrf(client),
    )
    assert again.status_code == 409
    _login(client, student.email)
    denied = client.post(
        f"/api/v1/admin/menu/{fries['id']}/pairings",
        json={"suggested_item_id": coke["id"]},
        headers=_csrf(client),
    )
    assert denied.status_code == 403
    pairings = client.get(f"/api/v1/menu/items/{fries['id']}/pairings")
    assert pairings.status_code == 200, pairings.text
    body = pairings.json()
    assert body["basis"] == "MANAGER"
    ids = [row["id"] for row in body["items"]]
    assert coke["id"] in ids
    assert drink["id"] not in ids
    assert body["items"][0]["price_paise"] == coke["price_paise"]


def test_menu_order_search_and_student_cannot_rearrange(client: TestClient) -> None:
    manager_email, college_id, _canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    _login(client, manager_email)
    banana = client.post(
        "/api/v1/admin/categories",
        json={"name": "Banana", "sort_order": 5},
        headers=_csrf(client),
    )
    apple = client.post(
        "/api/v1/admin/categories",
        json={"name": "Apple", "sort_order": 5},
        headers=_csrf(client),
    )
    assert banana.status_code == 201 and apple.status_code == 201
    listed = client.get("/api/v1/admin/categories")
    names = [row["name"] for row in listed.json()]
    assert names.index("Apple") < names.index("Banana")
    station = client.post(
        "/api/v1/admin/stations",
        json={"name": f"Counter {uuid.uuid4().hex[:4]}", "parallel_capacity": 1},
        headers=_csrf(client),
    )
    assert station.status_code == 201, station.text
    cheap = client.post(
        "/api/v1/admin/menu",
        json={
            "category_id": apple.json()["id"],
            "station_id": station.json()["id"],
            "name": "Mint Water",
            "description": "Cold mint water",
            "price_paise": 1500,
            "prep_seconds": 60,
            "initial_available_qty": 4,
        },
        headers=_csrf(client),
    )
    pricey = client.post(
        "/api/v1/admin/menu",
        json={
            "category_id": apple.json()["id"],
            "station_id": station.json()["id"],
            "name": "Almond Shake",
            "description": "Plain shake",
            "price_paise": 9000,
            "prep_seconds": 60,
            "initial_available_qty": 4,
            "is_featured": True,
        },
        headers=_csrf(client),
    )
    assert cheap.status_code == 201 and pricey.status_code == 201, pricey.text
    hidden = client.patch(
        f"/api/v1/admin/categories/{banana.json()['id']}",
        json={"is_active": False},
        headers=_csrf(client),
    )
    assert hidden.status_code == 200
    missing = client.post(
        f"/api/v1/admin/categories/{apple.json()['id']}/move",
        json={"direction": "up"},
    )
    assert missing.status_code == 403

    _login(client, student.email)
    categories = client.get("/api/v1/menu/categories")
    assert categories.status_code == 200
    visible = [row["name"] for row in categories.json()]
    assert visible == ["Apple"]
    by_price = client.get("/api/v1/menu/items?sort=price_asc")
    assert [row["name"] for row in by_price.json()["items"]] == ["Mint Water", "Almond Shake"]
    by_name = client.get("/api/v1/menu/items?sort=name")
    assert [row["name"] for row in by_name.json()["items"]] == ["Almond Shake", "Mint Water"]
    _login(client, manager_email)
    paused = client.patch(
        f"/api/v1/admin/menu/{pricey.json()['id']}",
        json={"is_available": False},
        headers=_csrf(client),
    )
    assert paused.status_code == 200
    _login(client, student.email)
    sold_out_last = client.get("/api/v1/menu/items?sort=name")
    assert [row["name"] for row in sold_out_last.json()["items"]] == ["Mint Water", "Almond Shake"]
    found = client.get("/api/v1/menu/items?q=MINT")
    assert [row["name"] for row in found.json()["items"]] == ["Mint Water"]
    specials = client.get("/api/v1/menu/items?featured=true")
    assert [row["name"] for row in specials.json()["items"]] == ["Almond Shake"]
    denied = client.post(
        f"/api/v1/admin/menu/{cheap.json()['id']}/move",
        json={"direction": "down"},
        headers=_csrf(client),
    )
    assert denied.status_code == 403
    placed = client.post(
        "/api/v1/orders",
        json={
            "items": [{"menu_item_id": cheap.json()["id"], "quantity": 1}],
            "idempotency_key": uuid.uuid4().hex,
        },
        headers=_csrf(client),
    )
    assert placed.status_code == 201, placed.text
    _login(client, manager_email)
    moved = client.post(
        f"/api/v1/admin/menu/{cheap.json()['id']}/move",
        json={"direction": "down"},
        headers=_csrf(client),
    )
    assert moved.status_code == 200
    _login(client, student.email)
    again = client.get(f"/api/v1/orders/{placed.json()['id']}")
    assert again.status_code == 200
    assert again.json()["total_paise"] == placed.json()["total_paise"]
    assert again.json()["items"][0]["unit_price_paise"] == 1500
