"""Deterministic station-aware readiness estimates.

The pilot uncertainty is 20 percent of the remaining estimate, and at least 60
seconds. There is no historical error model yet. An overdue running task keeps
its station slot and is projected 60 seconds past the current clock so it is
never treated as finished.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class StationSlot:
    station_id: str
    capacity: int
    is_active: bool


@dataclass(frozen=True)
class TaskWork:
    task_id: str
    order_id: str
    station_id: str
    status: str
    duration_seconds: int
    extra_delay_seconds: int
    started_at: datetime | None
    accepted_at: datetime
    ticket_number: str
    unit_index: int


@dataclass(frozen=True)
class OrderEstimate:
    order_id: str
    ready_at: datetime | None
    earliest_at: datetime | None
    latest_at: datetime | None
    overdue: bool
    blocked: bool


def schedule(
    *,
    now: datetime,
    stations: list[StationSlot],
    tasks: list[TaskWork],
    packing_buffer_seconds: int = 120,
    uncertainty_ratio: float = 0.2,
    min_uncertainty_seconds: int = 60,
    overdue_remainder_seconds: int = 60,
) -> dict[str, OrderEstimate]:
    by_station = {station.station_id: station for station in stations}
    finishes: dict[str, datetime] = {}
    overdue_orders: set[str] = set()
    blocked_orders: set[str] = set()
    active_orders = {task.order_id for task in tasks if task.status in {"QUEUED", "IN_PROGRESS"}}
    slots: dict[str, list[datetime]] = {}
    for station in stations:
        slots[station.station_id] = [now for _ in range(station.capacity)]

    running = [task for task in tasks if task.status == "IN_PROGRESS"]
    for task in running:
        station = by_station.get(task.station_id)
        if station is None or task.started_at is None:
            blocked_orders.add(task.order_id)
            continue
        expected_end = task.started_at + timedelta(
            seconds=task.duration_seconds + task.extra_delay_seconds
        )
        overdue = expected_end <= now
        finish = expected_end if not overdue else now + timedelta(seconds=overdue_remainder_seconds)
        if overdue:
            overdue_orders.add(task.order_id)
        _occupy_earliest(slots.setdefault(task.station_id, [now]), finish)
        finishes[task.task_id] = finish

    queued = sorted(
        (task for task in tasks if task.status == "QUEUED"),
        key=lambda task: (task.accepted_at, task.ticket_number, task.unit_index, task.task_id),
    )
    for task in queued:
        station = by_station.get(task.station_id)
        if station is None or not station.is_active or station.capacity < 1:
            blocked_orders.add(task.order_id)
            continue
        lane = slots.setdefault(task.station_id, [now for _ in range(station.capacity)])
        start = min(lane)
        begin = start if start > now else now
        finish = begin + timedelta(seconds=task.duration_seconds + task.extra_delay_seconds)
        lane[lane.index(start)] = finish
        finishes[task.task_id] = finish

    estimates: dict[str, OrderEstimate] = {}
    for order_id in active_orders:
        order_finishes = [
            finishes[task.task_id]
            for task in tasks
            if task.order_id == order_id and task.task_id in finishes and task.status != "DONE"
        ]
        if order_id in blocked_orders or not order_finishes:
            estimates[order_id] = OrderEstimate(
                order_id=order_id,
                ready_at=None,
                earliest_at=None,
                latest_at=None,
                overdue=order_id in overdue_orders,
                blocked=True,
            )
            continue
        ready = max(order_finishes) + timedelta(seconds=packing_buffer_seconds)
        remaining = max(0, int((ready - now).total_seconds()))
        span = max(min_uncertainty_seconds, int(remaining * uncertainty_ratio))
        earliest = ready - timedelta(seconds=span)
        if earliest < now:
            earliest = now
        estimates[order_id] = OrderEstimate(
            order_id=order_id,
            ready_at=ready,
            earliest_at=earliest,
            latest_at=ready + timedelta(seconds=span),
            overdue=order_id in overdue_orders,
            blocked=False,
        )
    return estimates


def _occupy_earliest(lane: list[datetime], finish: datetime) -> None:
    if not lane:
        lane.append(finish)
        return
    index = lane.index(min(lane))
    lane[index] = finish
