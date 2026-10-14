from datetime import UTC, datetime, timedelta

from app.services.eta import StationSlot, TaskWork, schedule

NOW = datetime(2026, 10, 15, 8, 0, tzinfo=UTC)


def _task(**overrides) -> TaskWork:
    base = dict(
        task_id="t",
        order_id="o",
        station_id="sandwich",
        status="QUEUED",
        duration_seconds=360,
        extra_delay_seconds=0,
        started_at=None,
        accepted_at=NOW,
        ticket_number="B00001",
        unit_index=1,
    )
    base.update(overrides)
    return TaskWork(**base)


def test_parallel_stations_use_the_later_finish_plus_packing() -> None:
    estimates = schedule(
        now=NOW,
        stations=[
            StationSlot("sandwich", 1, True),
            StationSlot("beverage", 1, True),
        ],
        tasks=[
            _task(
                task_id="ahead-s",
                order_id="other",
                status="IN_PROGRESS",
                duration_seconds=720,
                started_at=NOW,
            ),
            _task(
                task_id="ahead-c",
                order_id="other",
                station_id="beverage",
                status="IN_PROGRESS",
                duration_seconds=240,
                started_at=NOW,
            ),
            _task(task_id="sandwich", duration_seconds=360),
            _task(task_id="coffee", station_id="beverage", duration_seconds=180),
        ],
        packing_buffer_seconds=120,
        uncertainty_ratio=0,
        min_uncertainty_seconds=0,
    )
    ready = estimates["o"].ready_at
    assert ready is not None
    assert ready - NOW == timedelta(minutes=20)


def test_capacity_two_runs_sandwiches_together() -> None:
    estimates = schedule(
        now=NOW,
        stations=[StationSlot("sandwich", 2, True)],
        tasks=[
            _task(task_id="a", unit_index=1, duration_seconds=360),
            _task(task_id="b", unit_index=2, duration_seconds=360),
        ],
        packing_buffer_seconds=0,
        uncertainty_ratio=0,
        min_uncertainty_seconds=0,
    )
    assert estimates["o"].ready_at == NOW + timedelta(seconds=360)


def test_capacity_one_runs_sandwiches_in_order() -> None:
    estimates = schedule(
        now=NOW,
        stations=[StationSlot("sandwich", 1, True)],
        tasks=[
            _task(task_id="a", ticket_number="B00001", unit_index=1),
            _task(
                task_id="b",
                ticket_number="B00002",
                order_id="second",
                accepted_at=NOW + timedelta(seconds=1),
            ),
        ],
        packing_buffer_seconds=0,
        uncertainty_ratio=0,
        min_uncertainty_seconds=0,
    )
    assert estimates["o"].ready_at == NOW + timedelta(seconds=360)
    assert estimates["second"].ready_at == NOW + timedelta(seconds=720)


def test_overdue_running_task_stays_unfinished() -> None:
    estimates = schedule(
        now=NOW,
        stations=[StationSlot("sandwich", 1, True)],
        tasks=[
            _task(
                status="IN_PROGRESS",
                started_at=NOW - timedelta(minutes=10),
                duration_seconds=60,
            )
        ],
        packing_buffer_seconds=0,
        uncertainty_ratio=0,
        min_uncertainty_seconds=0,
        overdue_remainder_seconds=60,
    )
    assert estimates["o"].overdue is True
    assert estimates["o"].ready_at == NOW + timedelta(seconds=60)


def test_delay_pushes_the_finish() -> None:
    estimates = schedule(
        now=NOW,
        stations=[StationSlot("sandwich", 1, True)],
        tasks=[_task(extra_delay_seconds=300)],
        packing_buffer_seconds=0,
        uncertainty_ratio=0,
        min_uncertainty_seconds=0,
    )
    assert estimates["o"].ready_at == NOW + timedelta(seconds=660)
