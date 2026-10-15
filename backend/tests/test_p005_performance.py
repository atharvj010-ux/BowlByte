"""P005 latency measurements on real PostgreSQL (database bowlbyte_test).

These are single-process development measurements, not capacity claims. They only run when
P005_PERF=1 so the normal integration run stays fast:

    P005_PERF=1 python -m pytest -o addopts="" -m integration -s tests/test_p005_performance.py

Push acceptance here is the built-in simulator. It measures BowlByte's own outbox and database
work, never a real push service or a phone.
"""

import json
import os
import statistics
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

import app.services.kitchen as kitchen_service
from app.models.fulfillment import CashReceipt
from tests.test_cash_pickup_integration import (
    _complete,
    _confirm,
    _csrf,
    _db_one,
    _drain,
    _issue,
    _login,
    _order,
    _subscribe,
    _verify,
    _world,
    reset_tables,  # noqa: F401  (autouse fixture)
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.environ.get("P005_PERF") != "1", reason="set P005_PERF=1 to measure"),
]

SAMPLES = int(os.environ.get("P005_PERF_SAMPLES", "30"))


def _summary(values: list[float]) -> dict:
    ordered = sorted(values)
    return {
        "n": len(ordered),
        "mean_ms": round(statistics.fmean(ordered) * 1000, 1),
        "p50_ms": round(ordered[len(ordered) // 2] * 1000, 1),
        "p95_ms": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))] * 1000, 1),
        "max_ms": round(ordered[-1] * 1000, 1),
    }


def _prepare(client: TestClient, world, count: int, timings: list[float]) -> list[str]:
    """Create READY orders, timing only the READY request itself."""
    ids: list[str] = []
    for _ in range(count):
        saved = _order(world.student, uuid.UUID(world.item["id"]), 1)
        accepted = client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
        assert accepted.status_code == 200, accepted.text
        for task in accepted.json()["tasks"]:
            for step in ("start", "complete"):
                done = client.post(
                    f"/api/v1/staff/preparation-tasks/{task['id']}/{step}", headers=_csrf(client)
                )
                assert done.status_code == 200, done.text
        started = time.perf_counter()
        ready = client.post(
            f"/api/v1/staff/orders/{saved['id']}/ready",
            json={"packed": True},
            headers=_csrf(client),
        )
        timings.append(time.perf_counter() - started)
        assert ready.status_code == 200, ready.text
        ids.append(str(saved["id"]))
    return ids


def test_p005_latency_report(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    world = _world(client, stock=SAMPLES * 4 + 20)
    report: dict = {"samples": SAMPLES}

    # READY with the outbox insert, and the insert measured on its own.
    enqueue_times: list[float] = []
    real_enqueue = kitchen_service.enqueue_order_ready

    def timed_enqueue(*args, **kwargs):
        started = time.perf_counter()
        try:
            return real_enqueue(*args, **kwargs)
        finally:
            enqueue_times.append(time.perf_counter() - started)

    _login(client, world.student.email)
    _subscribe(client)  # the student has one device, so every READY has a delivery target
    _login(client, world.kitchen.email)
    monkeypatch.setattr(kitchen_service, "enqueue_order_ready", timed_enqueue)
    with_outbox: list[float] = []
    order_ids = _prepare(client, world, SAMPLES, with_outbox)
    monkeypatch.setattr(kitchen_service, "enqueue_order_ready", lambda *a, **k: None)
    without_outbox: list[float] = []
    _prepare(client, world, SAMPLES, without_outbox)
    monkeypatch.setattr(kitchen_service, "enqueue_order_ready", real_enqueue)
    report["ready_request_with_outbox"] = _summary(with_outbox)
    report["ready_request_without_outbox"] = _summary(without_outbox)
    report["outbox_enqueue_inside_ready"] = _summary(enqueue_times)

    # Worker drain against the simulator transport.
    totals: dict[str, int] = {}
    started = time.perf_counter()
    while True:
        batch = _drain()
        if not batch["claimed"]:
            break
        for name, count in batch.items():
            totals[name] = totals.get(name, 0) + count
    elapsed = time.perf_counter() - started
    report["outbox_drain"] = {
        "events_claimed": totals.get("claimed"),
        "seconds_total": round(elapsed, 3),
        "ms_per_event": round(elapsed / max(SAMPLES, 1) * 1000, 1),
        "stats": totals,
        "note": "simulator transport: measures BowlByte work, not a real push service",
    }

    # Student credential issue.
    _login(client, world.student.email)
    issue_times: list[float] = []
    credentials: dict[str, dict] = {}
    for order_id in order_ids:
        started = time.perf_counter()
        issued = _issue(client, order_id)
        issue_times.append(time.perf_counter() - started)
        assert issued.status_code == 200, issued.text
        credentials[order_id] = issued.json()
    report["pickup_credential_issue"] = _summary(issue_times)

    # Cashier: confirm cash, verify, redeem.
    _login(client, world.cashier.email)
    confirm_times: list[float] = []
    verify_times: list[float] = []
    redeem_times: list[float] = []
    for order_id in order_ids:
        started = time.perf_counter()
        paid = _confirm(client, order_id)
        confirm_times.append(time.perf_counter() - started)
        assert paid.status_code == 200, paid.text
    for order_id in order_ids:
        started = time.perf_counter()
        checked = _verify(client, token=credentials[order_id]["token"])
        verify_times.append(time.perf_counter() - started)
        assert checked.status_code == 200, checked.text
    for order_id in order_ids:
        started = time.perf_counter()
        done = _complete(client, order_id, token=credentials[order_id]["token"])
        redeem_times.append(time.perf_counter() - started)
        assert done.status_code == 200, done.text
    report["cash_confirmation"] = _summary(confirm_times)
    report["qr_verification"] = _summary(verify_times)
    report["pickup_redemption"] = _summary(redeem_times)

    assert _db_one(select(func.count()).select_from(CashReceipt)) == SAMPLES
    print("\nP005_PERF " + json.dumps(report, indent=2))


def test_p004_place_and_accept_baseline_rerun(client: TestClient) -> None:
    """Repeat the P004 measurement unchanged. P005 does not optimise this path."""

    world = _world(client, stock=400)
    _login(client, world.kitchen.email)
    results: dict[str, float] = {}
    placed = 0
    started = time.perf_counter()
    for target in (10, 50, 100):
        while placed < target:
            saved = _order(world.student, uuid.UUID(world.item["id"]), 1)
            accepted = client.post(
                f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client)
            )
            assert accepted.status_code == 200, accepted.text
            placed += 1
        results[str(target)] = round(time.perf_counter() - started, 2)
    print("\nP005_PERF_BASELINE " + json.dumps(results))
