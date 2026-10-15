"""Production, waste, forecasts, and plans against PostgreSQL."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.db.session import SessionLocal
from app.models.identity import CANTEEN_MANAGER, Canteen
from app.models.ordering import DailyStock
from app.services.forecasting import execute_training_job
from tests.test_ordering_integration import (
    _add_user,
    _bootstrap,
    _csrf,
    _login,
    _sellable,
    _student_email,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def reset_tables() -> None:
    from app.core.config import get_settings
    from app.services.rate_limit import clear_counters

    database = get_settings().database_url.rsplit("/", 1)[-1].split("?")[0]
    if database != "bowlbyte_test":
        pytest.fail("Food intelligence tests must use the bowlbyte_test database.")
    db = SessionLocal()
    db.execute(
        text(
            "TRUNCATE preparation_tasks, order_idempotency_records, "
            "inventory_adjustments, order_payments, "
            "order_events, order_items, orders, daily_stock, menu_item_station_assignments, "
            "menu_items, kitchen_stations, menu_categories, "
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


def _key() -> str:
    return uuid.uuid4().hex


def _stock_total() -> int:
    db = SessionLocal()
    total = db.scalar(select(func.coalesce(func.sum(DailyStock.available_qty), 0)))
    db.close()
    return int(total or 0)


def test_batch_equation_waste_and_permissions(client: TestClient) -> None:
    manager_email, college_id, canteen_id = _bootstrap()
    student = _add_user("STUDENT", _student_email(), None, college_id)
    cashier = _add_user(
        "CASHIER",
        f"cashier-{uuid.uuid4().hex[:6]}@staff.bowlbyte.edu",
        canteen_id,
        college_id,
    )
    kitchen = _add_user(
        "KITCHEN_STAFF",
        f"kitchen-{uuid.uuid4().hex[:6]}@staff.bowlbyte.edu",
        canteen_id,
        college_id,
    )
    _login(client, manager_email)
    item = _sellable(client, stock=8)
    before = _stock_total()
    created = client.post(
        "/api/v1/admin/production",
        json={
            "menu_item_id": item["id"],
            "service_date": "2026-10-15",
            "service_period": "LUNCH",
            "produced_qty": 10,
            "prepared_at": datetime.now(UTC).isoformat(),
            "notes": "Morning batch",
            "idempotency_key": _key(),
        },
        headers=_csrf(client),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["produced_qty"] == 10
    assert body["remaining_qty"] == 10
    assert _stock_total() == before
    served = client.post(
        f"/api/v1/admin/production/{body['id']}/adjust",
        json={
            "kind": "SERVE_COUNTER",
            "quantity": 4,
            "reason": "Counter sales",
            "idempotency_key": _key(),
        },
        headers=_csrf(client),
    )
    assert served.status_code == 200, served.text
    discarded = client.post(
        f"/api/v1/admin/production/{body['id']}/adjust",
        json={
            "kind": "DISCARD",
            "quantity": 2,
            "reason": "Left at close",
            "waste_reason": "UNSOLD",
            "idempotency_key": _key(),
        },
        headers=_csrf(client),
    )
    assert discarded.status_code == 200, discarded.text
    assert discarded.json()["remaining_qty"] == 4
    assert (
        discarded.json()["produced_qty"]
        == discarded.json()["served_counter_qty"]
        + discarded.json()["remaining_qty"]
        + discarded.json()["discarded_qty"]
    )
    impossible = client.post(
        f"/api/v1/admin/production/{body['id']}/adjust",
        json={"kind": "CORRECT", "quantity": 1, "reason": "Too small", "idempotency_key": _key()},
        headers=_csrf(client),
    )
    assert impossible.status_code == 409
    assert _stock_total() == before
    other = Canteen(college_id=college_id, name="Other", slug=f"other-{uuid.uuid4().hex[:6]}")
    db = SessionLocal()
    db.add(other)
    db.commit()
    other_id = other.id
    db.close()
    outsider = _add_user(
        CANTEEN_MANAGER,
        f"other-{uuid.uuid4().hex[:6]}@staff.bowlbyte.edu",
        other_id,
        college_id,
    )
    outsider_client = TestClient(client.app)
    outsider_client.headers.update({"origin": "http://localhost:3000"})
    _login(outsider_client, outsider.email)
    hidden = outsider_client.get(f"/api/v1/admin/production/{body['id']}")
    assert hidden.status_code == 404
    _login(client, student.email)
    denied = client.get("/api/v1/admin/production")
    assert denied.status_code == 403
    _login(client, cashier.email)
    assert (
        client.post(
            "/api/v1/admin/forecasting/train", json={"source": "REAL", "idempotency_key": _key()}
        ).status_code
        == 403
    )
    _login(client, kitchen.email)
    assert (
        client.post(
            "/api/v1/admin/planning/generate",
            json={"service_date": "2026-10-16", "idempotency_key": _key()},
            headers=_csrf(client),
        ).status_code
        == 403
    )


def test_demo_training_forecast_and_plan_do_not_move_stock(client: TestClient) -> None:
    manager_email, _, _ = _bootstrap()
    _login(client, manager_email)
    _sellable(client, stock=6)
    before = _stock_total()
    seeded = client.post(
        "/api/v1/admin/intelligence/demo-dataset",
        json={"days": 60, "seed": 7},
        headers=_csrf(client),
    )
    assert seeded.status_code == 201, seeded.text
    assert seeded.json()["source"] == "DEMO"
    db = SessionLocal()
    order_count = db.scalar(text("SELECT count(*) FROM orders"))
    db.close()
    assert int(order_count or 0) == 0
    trained = client.post(
        "/api/v1/admin/forecasting/train",
        json={"source": "DEMO", "idempotency_key": _key()},
        headers=_csrf(client),
    )
    assert trained.status_code == 202, trained.text
    execute_training_job(uuid.UUID(trained.json()["id"]))
    job = client.get(f"/api/v1/admin/forecasting/jobs/{trained.json()['id']}")
    assert job.status_code == 200
    assert job.json()["status"] == "SUCCEEDED"
    models = client.get("/api/v1/admin/forecasts/models")
    assert models.status_code == 200
    assert {row["source"] for row in models.json()["models"]} == {"DEMO"}
    assert any(row["evaluations"] for row in models.json()["models"])
    forecast = client.post(
        "/api/v1/admin/forecasts/generate",
        json={"source": "DEMO", "horizon_days": 7, "idempotency_key": _key()},
        headers=_csrf(client),
    )
    assert forecast.status_code == 201, forecast.text
    assert forecast.json()["status"] == "COMPLETE"
    assert forecast.json()["source"] == "DEMO"
    assert len(forecast.json()["values"]) >= 7
    service_day = (date.today() + timedelta(days=1)).isoformat()
    plan = client.post(
        "/api/v1/admin/planning/generate",
        json={
            "service_date": service_day,
            "forecast_run_id": forecast.json()["id"],
            "idempotency_key": _key(),
        },
        headers=_csrf(client),
    )
    assert plan.status_code == 201, plan.text
    approved = client.post(
        f"/api/v1/admin/planning/{plan.json()['id']}/approve",
        json={"reason": "Accepted for tomorrow."},
        headers=_csrf(client),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    batches = client.get(f"/api/v1/admin/production?date_from={service_day}&date_to={service_day}")
    assert batches.json()["total"] == 0
    assert _stock_total() == before
    again = client.post(
        f"/api/v1/admin/planning/{plan.json()['id']}/approve",
        json={"reason": "Accepted for tomorrow."},
        headers=_csrf(client),
    )
    assert again.json()["status"] == "APPROVED"
    simulated = client.post(
        "/api/v1/admin/planning/simulate",
        json={
            "service_date": service_day,
            "demand_factor": 1.2,
            "forecast_run_id": forecast.json()["id"],
        },
        headers=_csrf(client),
    )
    assert simulated.status_code == 200, simulated.text
    assert simulated.json()["simulation"] is True
    assert _stock_total() == before


def test_real_history_without_enough_days_is_honest(client: TestClient) -> None:
    manager_email, _, _ = _bootstrap()
    _login(client, manager_email)
    _sellable(client)
    trained = client.post(
        "/api/v1/admin/forecasting/train",
        json={"source": "REAL", "idempotency_key": _key()},
        headers=_csrf(client),
    )
    execute_training_job(uuid.UUID(trained.json()["id"]))
    models = client.get("/api/v1/admin/forecasts/models").json()["models"]
    assert models
    assert models[0]["metrics"]["status"] == "INSUFFICIENT_DATA"
    forecast = client.post(
        "/api/v1/admin/forecasts/generate",
        json={"source": "REAL", "horizon_days": 1, "idempotency_key": _key()},
        headers=_csrf(client),
    )
    assert forecast.status_code == 201
    assert forecast.json()["status"] == "INSUFFICIENT_DATA"
