"""Real forecast training on the disposable bowlbyte_test database."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.identity import User
from app.models.intelligence import ForecastJob
from app.models.ordering import Order
from app.services.forecasting import seed_demo
from app.services.rate_limit import clear_counters
from app.worker import train_forecast_task
from tests.disposable_guard import require_disposable_database
from tests.test_ordering_integration import _bootstrap, _login, _sellable

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def reset_tables() -> None:
    require_disposable_database()
    get_settings()
    db = SessionLocal()
    db.execute(
        text(
            "TRUNCATE model_evaluations, demand_forecast_values, demand_forecast_runs, "
            "preparation_plan_events, preparation_plan_items, preparation_plans, "
            "forecast_jobs, forecasting_models, demo_demand_days, canteen_closures, "
            "food_waste_records, production_quantity_events, food_production_batches, "
            "order_hold_events, preparation_tasks, order_idempotency_records, "
            "inventory_adjustments, order_payments, order_events, order_items, orders, "
            "daily_stock, menu_item_station_assignments, menu_item_pairings, menu_items, "
            "kitchen_stations, menu_categories, audit_log, sessions, staff_invitations, "
            "email_verification_tokens, student_roster_entries, staff_memberships, "
            "student_profiles, users, canteens, colleges RESTART IDENTITY CASCADE"
        )
    )
    db.commit()
    db.close()
    clear_counters()
    yield
    clear_counters()


def _queue(canteen_id: object, manager_id: object) -> uuid.UUID:
    db = SessionLocal()
    job = ForecastJob(
        canteen_id=canteen_id,
        source="DEMO",
        status="PENDING",
        idempotency_key=uuid.uuid4().hex,
        requested_by=manager_id,
    )
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()
    return job_id


def test_isolated_worker_completes_and_fails_training(client: TestClient, tmp_path: Path) -> None:
    manager_email, _, canteen_id = _bootstrap()
    _login(client, manager_email)
    _sellable(client, stock=4)
    db = SessionLocal()
    manager = db.scalar(select(User).where(User.email == manager_email))
    assert manager is not None
    seeded = seed_demo(db, manager=manager, days=60, seed=7)
    manager_id = manager.id
    db.close()
    assert seeded["rows"] > 0

    succeeded = _queue(canteen_id, manager_id)
    train_forecast_task(str(succeeded))
    db = SessionLocal()
    done = db.get(ForecastJob, succeeded)
    assert done is not None
    assert done.status == "SUCCEEDED"
    assert done.model_id is not None
    assert db.scalar(select(func.count()).select_from(Order)) == 0
    db.close()

    blocker = tmp_path / "not-a-directory"
    blocker.write_text("block", encoding="utf-8")
    settings = get_settings()
    saved = settings.forecast_artifact_dir
    settings.forecast_artifact_dir = str(blocker)
    try:
        failed = _queue(canteen_id, manager_id)
        train_forecast_task(str(failed))
    finally:
        settings.forecast_artifact_dir = saved
    db = SessionLocal()
    broken = db.get(ForecastJob, failed)
    assert broken is not None
    assert broken.status == "FAILED"
    assert broken.error == "Training failed before a model could be saved."
    db.close()
