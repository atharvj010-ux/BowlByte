"""Kitchen acceptance, preparation tasks, and stock consumption."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.identity import User
from app.models.ordering import (
    DailyStock,
    InventoryAdjustment,
    KitchenStation,
    Order,
    OrderEvent,
    OrderItem,
    OrderPayment,
    PreparationTask,
)
from app.services.eta import OrderEstimate, StationSlot, TaskWork, schedule
from app.services.ordering import kitchen_canteen_id, manager_canteen_id
from app.services.realtime import publish_kitchen_event

Clock = Callable[[], datetime]
ACTIVE = ("QUEUED", "PREPARING")
OPEN_TASKS = ("QUEUED", "IN_PROGRESS")


def utcnow() -> datetime:
    return datetime.now(UTC)


def accept_order(
    db: Session,
    *,
    staff: User,
    order_id: UUID,
    clock: Clock = utcnow,
) -> dict:
    canteen_id = kitchen_canteen_id(db, staff)
    _lock_queue(db, canteen_id)
    order = _lock_order(db, order_id, canteen_id)
    if order.status in {"QUEUED", "PREPARING", "READY"}:
        return _tracked(db, order, include_tasks=True)
    if order.status != "PLACED":
        raise ApiError(code="CONFLICT", message="This order cannot be accepted.", status_code=409)
    lines = list(
        db.scalars(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id))
    )
    units = sum(line.quantity for line in lines)
    limit = get_settings().kitchen_max_tasks_per_order
    if units > limit:
        raise ApiError(
            code="CONFLICT",
            message=(
                f"This order has {units} portions. The pilot queue accepts at most {limit}. "
                "Split it into smaller orders."
            ),
            status_code=409,
        )
    station_ids = sorted(
        {line.station_id for line in lines if line.station_id is not None},
        key=str,
    )
    stations = _lock_stations(db, station_ids)
    for line in lines:
        if line.station_id is None:
            raise ApiError(
                code="CONFLICT",
                message=(
                    f"Assign a preparation station to {line.item_name} before the kitchen "
                    "can accept this order."
                ),
                status_code=409,
            )
        station = stations.get(line.station_id)
        if station is None or station.canteen_id != canteen_id or not station.is_active:
            raise ApiError(
                code="CONFLICT",
                message=f"{line.item_name} is assigned to a station that is not active.",
                status_code=409,
            )
    now = clock()
    for line in lines:
        station = stations[line.station_id]
        for index in range(1, line.quantity + 1):
            db.add(
                PreparationTask(
                    order_id=order.id,
                    order_item_id=line.id,
                    canteen_id=canteen_id,
                    kitchen_station_id=station.id,
                    station_name=station.name,
                    item_name=line.item_name,
                    unit_index=index,
                    status="QUEUED",
                    expected_duration_seconds=line.prep_seconds,
                    extra_delay_seconds=0,
                    created_at=now,
                    updated_at=now,
                )
            )
    order.accepted_at = now
    _transition(db, order, "ACCEPTED", staff.id, "kitchen_accept", now)
    _transition(db, order, "QUEUED", staff.id, "kitchen_queue", now)
    _refresh(db, canteen_id, clock)
    db.commit()
    db.refresh(order)
    _emit(order, "order.accepted")
    return _tracked(db, order, include_tasks=True)


def reject_order(
    db: Session,
    *,
    staff: User,
    order_id: UUID,
    reason: str,
    clock: Clock = utcnow,
) -> dict:
    canteen_id = kitchen_canteen_id(db, staff)
    _lock_queue(db, canteen_id)
    order = _lock_order(db, order_id, canteen_id)
    if order.status == "REJECTED":
        return _tracked(db, order, include_tasks=True)
    if order.status not in {"PLACED", "QUEUED"}:
        raise ApiError(
            code="CONFLICT",
            message="Preparation has started, so this order cannot be rejected here.",
            status_code=409,
        )
    tasks = _lock_tasks(db, order.id)
    if any(task.status != "QUEUED" for task in tasks):
        raise ApiError(
            code="CONFLICT",
            message="Preparation has started, so this order cannot be rejected here.",
            status_code=409,
        )
    now = clock()
    lines = list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)))
    _release_reservations(db, order, lines, staff.id)
    for task in tasks:
        task.status = "CANCELLED"
        task.updated_at = now
    _transition(db, order, "REJECTED", staff.id, reason.strip(), now)
    _refresh(db, canteen_id, clock)
    db.commit()
    db.refresh(order)
    _emit(order, "order.rejected")
    return _tracked(db, order, include_tasks=True)


def start_task(
    db: Session,
    *,
    staff: User,
    task_id: UUID,
    clock: Clock = utcnow,
) -> dict:
    canteen_id = kitchen_canteen_id(db, staff)
    preview = _visible_task(db, task_id, canteen_id)
    # Queue rows first, in id order, so two starts cannot each hold one order
    # and then wait to update the other order's estimate.
    _lock_queue(db, canteen_id)
    order = _lock_order(db, preview.order_id, canteen_id)
    # Station before task: locking a task takes a key share on its station,
    # and upgrading that share to FOR UPDATE deadlocks two concurrent starts.
    station = _lock_station(db, preview.kitchen_station_id)
    task = _lock_task(db, task_id, canteen_id)
    if task.status != "QUEUED":
        raise ApiError(code="CONFLICT", message="That task is no longer waiting.", status_code=409)
    if order.status not in {"QUEUED", "PREPARING"}:
        raise ApiError(
            code="CONFLICT", message="This order is not in the kitchen queue.", status_code=409
        )
    if station is None or not station.is_active:
        raise ApiError(
            code="CONFLICT",
            message="That station is not accepting work.",
            status_code=409,
        )
    active = (
        db.scalar(
            select(func.count())
            .select_from(PreparationTask)
            .where(
                PreparationTask.kitchen_station_id == station.id,
                PreparationTask.status == "IN_PROGRESS",
            )
        )
        or 0
    )
    if int(active) >= station.parallel_capacity:
        raise ApiError(code="CONFLICT", message="That station is at capacity.", status_code=409)
    free = station.parallel_capacity - int(active)
    eligible = set(
        db.scalars(
            select(PreparationTask.id)
            .join(Order, Order.id == PreparationTask.order_id)
            .where(
                PreparationTask.kitchen_station_id == station.id,
                PreparationTask.status == "QUEUED",
            )
            .order_by(
                Order.accepted_at.asc().nulls_last(),
                Order.ticket_number,
                PreparationTask.unit_index,
                PreparationTask.id,
            )
            .limit(free)
        )
    )
    if task.id not in eligible:
        raise ApiError(
            code="CONFLICT",
            message="An earlier ticket is waiting at this station.",
            status_code=409,
        )
    line = db.get(OrderItem, task.order_item_id)
    if line is None:
        raise ApiError(code="CONFLICT", message="The ordered item is missing.", status_code=409)
    stock = _lock_one_stock(db, line.menu_item_id, order.service_date)
    if stock is None or stock.reserved_qty < 1:
        raise ApiError(
            code="CONFLICT",
            message="Reserved stock could not be consumed.",
            status_code=409,
        )
    now = clock()
    stock.reserved_qty -= 1
    stock.consumed_qty += 1
    stock.updated_at = now
    db.add(
        InventoryAdjustment(
            daily_stock_id=stock.id,
            menu_item_id=line.menu_item_id,
            actor_user_id=staff.id,
            order_id=order.id,
            delta_available=0,
            delta_reserved=-1,
            reason="task_consume",
        )
    )
    task.status = "IN_PROGRESS"
    task.started_at = now
    task.started_by = staff.id
    task.updated_at = now
    if order.status == "QUEUED":
        _transition(db, order, "PREPARING", staff.id, "task_started", now)
    else:
        order.version += 1
        order.updated_at = now
    _refresh(db, canteen_id, clock)
    db.commit()
    db.refresh(order)
    _emit(order, "task.started")
    return _tracked(db, order, include_tasks=True)


def complete_task(
    db: Session,
    *,
    staff: User,
    task_id: UUID,
    clock: Clock = utcnow,
) -> dict:
    canteen_id = kitchen_canteen_id(db, staff)
    preview = _visible_task(db, task_id, canteen_id)
    _lock_queue(db, canteen_id)
    order = _lock_order(db, preview.order_id, canteen_id)
    task = _lock_task(db, task_id, canteen_id)
    if task.status == "DONE":
        return _tracked(db, order, include_tasks=True)
    if task.status != "IN_PROGRESS":
        raise ApiError(
            code="CONFLICT", message="Start the task before completing it.", status_code=409
        )
    now = clock()
    task.status = "DONE"
    task.completed_at = now
    task.completed_by = staff.id
    task.updated_at = now
    order.version += 1
    order.updated_at = now
    db.add(
        OrderEvent(
            order_id=order.id,
            from_status=order.status,
            to_status=order.status,
            actor_user_id=staff.id,
            reason="task_completed",
        )
    )
    _refresh(db, canteen_id, clock)
    db.commit()
    db.refresh(order)
    _emit(order, "task.completed")
    return _tracked(db, order, include_tasks=True)


def delay_task(
    db: Session,
    *,
    staff: User,
    task_id: UUID,
    extra_seconds: int,
    reason: str,
    clock: Clock = utcnow,
) -> dict:
    canteen_id = kitchen_canteen_id(db, staff)
    preview = _visible_task(db, task_id, canteen_id)
    _lock_queue(db, canteen_id)
    order = _lock_order(db, preview.order_id, canteen_id)
    task = _lock_task(db, task_id, canteen_id)
    if task.status not in OPEN_TASKS:
        raise ApiError(code="CONFLICT", message="Only open tasks can be delayed.", status_code=409)
    now = clock()
    task.extra_delay_seconds += extra_seconds
    task.delay_reason = reason.strip()
    task.updated_at = now
    order.version += 1
    order.updated_at = now
    db.add(
        OrderEvent(
            order_id=order.id,
            from_status=order.status,
            to_status=order.status,
            actor_user_id=staff.id,
            reason=f"delay:{reason.strip()}",
        )
    )
    _refresh(db, canteen_id, clock)
    db.commit()
    db.refresh(order)
    _emit(order, "task.delayed")
    return _tracked(db, order, include_tasks=True)


def mark_ready(
    db: Session,
    *,
    staff: User,
    order_id: UUID,
    clock: Clock = utcnow,
) -> dict:
    canteen_id = kitchen_canteen_id(db, staff)
    _lock_queue(db, canteen_id)
    order = _lock_order(db, order_id, canteen_id)
    if order.status == "READY":
        return _tracked(db, order, include_tasks=True)
    if order.status != "PREPARING":
        raise ApiError(
            code="CONFLICT", message="This order is not being prepared.", status_code=409
        )
    tasks = _lock_tasks(db, order.id)
    if not tasks or any(task.status != "DONE" for task in tasks):
        raise ApiError(
            code="CONFLICT",
            message="Finish every preparation task before marking the order ready.",
            status_code=409,
        )
    now = clock()
    order.ready_at = now
    _transition(db, order, "READY", staff.id, "packed", now)
    _refresh(db, canteen_id, clock)
    db.commit()
    db.refresh(order)
    _emit(order, "order.ready")
    return _tracked(db, order, include_tasks=True)


def kitchen_queue(db: Session, *, staff: User, limit: int) -> dict:
    canteen_id = kitchen_canteen_id(db, staff)
    orders = list(
        db.scalars(
            select(Order)
            .where(Order.canteen_id == canteen_id, Order.status.in_([*ACTIVE, "READY"]))
            .order_by(Order.accepted_at.asc().nulls_last(), Order.created_at)
            .limit(limit)
        )
    )
    return {
        "orders": [_tracked(db, order, include_tasks=True) for order in orders],
        "stations": station_workload(db, canteen_id),
    }


def preparation_tasks(db: Session, *, staff: User, limit: int) -> list[dict]:
    canteen_id = kitchen_canteen_id(db, staff)
    tasks = list(
        db.scalars(
            select(PreparationTask)
            .where(
                PreparationTask.canteen_id == canteen_id,
                PreparationTask.status.in_(OPEN_TASKS),
            )
            .order_by(PreparationTask.created_at, PreparationTask.unit_index)
            .limit(limit)
        )
    )
    return [_task_payload(task) for task in tasks]


def station_board(db: Session, *, staff: User) -> list[dict]:
    return station_workload(db, kitchen_canteen_id(db, staff))


def student_tracking(db: Session, *, student: User, order_id: UUID) -> dict:
    order = db.scalar(
        select(Order).where(Order.id == order_id, Order.student_user_id == student.id)
    )
    if order is None:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    return _tracked(db, order, include_tasks=True)


def refresh_after_station_change(db: Session, *, canteen_id: UUID) -> None:
    _refresh(db, canteen_id, utcnow)
    db.commit()


def manager_overview(db: Session, *, manager: User) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    now = utcnow()
    counts = {
        status: int(
            db.scalar(
                select(func.count())
                .select_from(Order)
                .where(
                    Order.canteen_id == canteen_id,
                    Order.status == status,
                )
            )
            or 0
        )
        for status in ("PLACED", "QUEUED", "PREPARING", "READY")
    }
    done = list(
        db.execute(
            select(PreparationTask.started_at, PreparationTask.completed_at, Order.accepted_at)
            .join(Order, Order.id == PreparationTask.order_id)
            .where(
                PreparationTask.canteen_id == canteen_id,
                PreparationTask.status == "DONE",
                PreparationTask.started_at.is_not(None),
                PreparationTask.completed_at.is_not(None),
            )
        )
    )
    prep_samples = [
        (row.completed_at - row.started_at).total_seconds()
        for row in done
        if row.completed_at and row.started_at
    ]
    wait_samples = [
        (row.started_at - row.accepted_at).total_seconds()
        for row in done
        if row.started_at and row.accepted_at
    ]
    delayed = int(
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(
                Order.canteen_id == canteen_id,
                Order.status.in_(ACTIVE),
                (Order.eta_overdue.is_(True)) | (Order.eta_latest_at < now),
            )
        )
        or 0
    )
    return {
        "placed": counts["PLACED"],
        "waiting": counts["QUEUED"],
        "preparing": counts["PREPARING"],
        "ready": counts["READY"],
        "active_orders": counts["QUEUED"] + counts["PREPARING"] + counts["READY"],
        "average_observed_prep_seconds": _average(prep_samples),
        "average_queue_wait_seconds": _average(wait_samples),
        "delayed_orders": delayed,
        "stations": station_workload(db, canteen_id),
        "notes": {
            "observed": "Averages use completed tasks with both a start and a finish.",
            "estimated": "Station backlog is the current ETA projection, not observed history.",
            "cash_collected": "Cash collection is not recorded in this phase.",
        },
    }


def station_workload(db: Session, canteen_id: UUID) -> list[dict]:
    stations = list(
        db.scalars(
            select(KitchenStation)
            .where(KitchenStation.canteen_id == canteen_id)
            .order_by(KitchenStation.name)
        )
    )
    rows = []
    for station in stations:
        waiting = _count_tasks(db, station.id, "QUEUED")
        preparing = _count_tasks(db, station.id, "IN_PROGRESS")
        oldest = db.scalar(
            select(Order.ticket_number)
            .join(PreparationTask, PreparationTask.order_id == Order.id)
            .where(
                PreparationTask.kitchen_station_id == station.id,
                PreparationTask.status == "QUEUED",
            )
            .order_by(Order.accepted_at.asc().nulls_last(), Order.ticket_number)
            .limit(1)
        )
        backlog = waiting * 0
        queued = list(
            db.scalars(
                select(PreparationTask.expected_duration_seconds).where(
                    PreparationTask.kitchen_station_id == station.id,
                    PreparationTask.status == "QUEUED",
                )
            )
        )
        if station.parallel_capacity:
            backlog = int(sum(queued) / station.parallel_capacity) if queued else 0
        rows.append(
            {
                "id": station.id,
                "name": station.name,
                "parallel_capacity": station.parallel_capacity,
                "is_active": station.is_active,
                "waiting": waiting,
                "in_progress": preparing,
                "backlog_seconds": backlog,
                "longest_waiting_ticket": oldest,
            }
        )
    return rows


def _refresh(db: Session, canteen_id: UUID, clock: Clock) -> None:
    # The session disables autoflush. New tasks must be written before the
    # workload query, or the order that was just accepted has no estimate.
    db.flush()
    now = clock()
    settings = get_settings()
    stations = list(
        db.scalars(select(KitchenStation).where(KitchenStation.canteen_id == canteen_id))
    )
    tasks = list(
        db.scalars(
            select(PreparationTask).where(
                PreparationTask.canteen_id == canteen_id,
                PreparationTask.status.in_(("QUEUED", "IN_PROGRESS", "DONE")),
            )
        )
    )
    orders = {
        order.id: order
        for order in db.scalars(
            select(Order).where(
                Order.canteen_id == canteen_id,
                Order.status.in_(("QUEUED", "PREPARING")),
            )
        )
    }
    work = []
    for task in tasks:
        order = orders.get(task.order_id)
        if order is None or order.accepted_at is None:
            continue
        work.append(
            TaskWork(
                task_id=str(task.id),
                order_id=str(task.order_id),
                station_id=str(task.kitchen_station_id),
                status=task.status,
                duration_seconds=task.expected_duration_seconds,
                extra_delay_seconds=task.extra_delay_seconds,
                started_at=task.started_at,
                accepted_at=order.accepted_at,
                ticket_number=order.ticket_number,
                unit_index=task.unit_index,
            )
        )
    estimates = schedule(
        now=now,
        stations=[
            StationSlot(str(station.id), station.parallel_capacity, station.is_active)
            for station in stations
        ],
        tasks=work,
        packing_buffer_seconds=settings.kitchen_packing_buffer_seconds,
        uncertainty_ratio=settings.kitchen_eta_uncertainty_ratio,
        min_uncertainty_seconds=settings.kitchen_eta_min_uncertainty_seconds,
        overdue_remainder_seconds=settings.kitchen_overdue_remainder_seconds,
    )
    for order in orders.values():
        estimate = estimates.get(str(order.id))
        if estimate is None:
            owned = [
                task for task in tasks if task.order_id == order.id and task.status != "CANCELLED"
            ]
            if owned and all(task.status == "DONE" for task in owned):
                ready = now + timedelta(seconds=settings.kitchen_packing_buffer_seconds)
                estimate = OrderEstimate(
                    str(order.id),
                    ready,
                    now,
                    ready + timedelta(seconds=settings.kitchen_eta_min_uncertainty_seconds),
                    False,
                    False,
                )
        _store_estimate(order, estimate, now)


def _store_estimate(order: Order, estimate: OrderEstimate | None, now: datetime) -> None:
    ready = estimate.ready_at if estimate else None
    changed = _seconds(order.eta_ready_at) != _seconds(ready) or (
        estimate is not None
        and (order.eta_overdue != estimate.overdue or order.eta_blocked != estimate.blocked)
    )
    if estimate is None:
        if order.eta_ready_at is not None or order.eta_blocked:
            order.eta_ready_at = None
            order.eta_earliest_at = None
            order.eta_latest_at = None
            order.eta_blocked = False
            order.eta_version += 1
            order.eta_computed_at = now
        return
    if not changed and order.eta_computed_at is not None:
        return
    order.eta_ready_at = estimate.ready_at
    order.eta_earliest_at = estimate.earliest_at
    order.eta_latest_at = estimate.latest_at
    order.eta_overdue = estimate.overdue
    order.eta_blocked = estimate.blocked
    order.eta_version += 1
    order.eta_computed_at = now


def _tracked(db: Session, order: Order, *, include_tasks: bool) -> dict:
    payment = db.scalar(select(OrderPayment).where(OrderPayment.order_id == order.id))
    if payment is None:
        raise ApiError(code="INTERNAL_ERROR", message="Order payment is missing.", status_code=500)
    items = list(
        db.scalars(
            select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.item_name)
        )
    )
    tasks = []
    if include_tasks:
        tasks = [
            _task_payload(task)
            for task in db.scalars(
                select(PreparationTask)
                .where(PreparationTask.order_id == order.id)
                .order_by(PreparationTask.item_name, PreparationTask.unit_index)
            )
        ]
    return {
        "id": order.id,
        "ticket_number": order.ticket_number,
        "status": order.status,
        "version": order.version,
        "total_paise": order.total_paise,
        "note": order.note,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "accepted_at": order.accepted_at,
        "ready_at": order.ready_at,
        "eta_ready_at": order.eta_ready_at,
        "eta_earliest_at": order.eta_earliest_at,
        "eta_latest_at": order.eta_latest_at,
        "eta_computed_at": order.eta_computed_at,
        "eta_version": order.eta_version,
        "eta_overdue": order.eta_overdue,
        "eta_blocked": order.eta_blocked,
        "payment": {
            "method": payment.method,
            "status": payment.status,
            "amount_paise": payment.amount_paise,
        },
        "items": [
            {
                "menu_item_id": line.menu_item_id,
                "item_name": line.item_name,
                "unit_price_paise": line.unit_price_paise,
                "quantity": line.quantity,
                "line_total_paise": line.line_total_paise,
                "station_name": line.station_name,
                "prep_seconds": line.prep_seconds,
            }
            for line in items
        ],
        "tasks": tasks,
    }


def _task_payload(task: PreparationTask) -> dict:
    return {
        "id": task.id,
        "order_id": task.order_id,
        "order_item_id": task.order_item_id,
        "station_id": task.kitchen_station_id,
        "station_name": task.station_name,
        "item_name": task.item_name,
        "unit_index": task.unit_index,
        "status": task.status,
        "expected_duration_seconds": task.expected_duration_seconds,
        "extra_delay_seconds": task.extra_delay_seconds,
        "delay_reason": task.delay_reason,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }


def _transition(
    db: Session,
    order: Order,
    status: str,
    actor_id: UUID,
    reason: str,
    now: datetime,
) -> None:
    previous = order.status
    order.status = status
    order.version += 1
    order.updated_at = now
    db.add(
        OrderEvent(
            order_id=order.id,
            from_status=previous,
            to_status=status,
            actor_user_id=actor_id,
            reason=reason,
        )
    )


def _release_reservations(
    db: Session,
    order: Order,
    lines: list[OrderItem],
    actor_id: UUID,
) -> None:
    stocks = _lock_stock(
        db, sorted((line.menu_item_id for line in lines), key=str), order.service_date
    )
    for line in lines:
        stock = stocks.get(line.menu_item_id)
        if stock is None or stock.reserved_qty < line.quantity:
            raise ApiError(
                code="CONFLICT",
                message="Reserved stock could not be released.",
                status_code=409,
            )
        stock.reserved_qty -= line.quantity
        stock.available_qty += line.quantity
        stock.updated_at = utcnow()
        db.add(
            InventoryAdjustment(
                daily_stock_id=stock.id,
                menu_item_id=line.menu_item_id,
                actor_user_id=actor_id,
                order_id=order.id,
                delta_available=line.quantity,
                delta_reserved=-line.quantity,
                reason="order_reject",
            )
        )


def _lock_queue(db: Session, canteen_id: UUID) -> None:
    db.scalars(
        select(Order)
        .where(
            Order.canteen_id == canteen_id,
            Order.status.in_(("QUEUED", "PREPARING")),
        )
        .order_by(Order.id)
        .with_for_update()
    ).all()


def _lock_order(db: Session, order_id: UUID, canteen_id: UUID) -> Order:
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None or order.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    return order


def _visible_task(db: Session, task_id: UUID, canteen_id: UUID) -> PreparationTask:
    task = db.get(PreparationTask, task_id)
    if task is None or task.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Preparation task not found.", status_code=404)
    return task


def _lock_task(db: Session, task_id: UUID, canteen_id: UUID) -> PreparationTask:
    task = db.scalar(select(PreparationTask).where(PreparationTask.id == task_id).with_for_update())
    if task is None or task.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Preparation task not found.", status_code=404)
    return task


def _lock_tasks(db: Session, order_id: UUID) -> list[PreparationTask]:
    return list(
        db.scalars(
            select(PreparationTask)
            .where(PreparationTask.order_id == order_id)
            .order_by(PreparationTask.id)
            .with_for_update()
        )
    )


def _lock_station(db: Session, station_id: UUID) -> KitchenStation | None:
    return db.scalar(
        select(KitchenStation).where(KitchenStation.id == station_id).with_for_update()
    )


def _lock_stations(db: Session, station_ids: list[UUID]) -> dict[UUID, KitchenStation]:
    if not station_ids:
        return {}
    rows = db.scalars(
        select(KitchenStation)
        .where(KitchenStation.id.in_(station_ids))
        .order_by(KitchenStation.id)
        .with_for_update()
    )
    return {row.id: row for row in rows}


def _lock_stock(db: Session, item_ids: list[UUID], service_date) -> dict[UUID, DailyStock]:
    if not item_ids:
        return {}
    rows = db.scalars(
        select(DailyStock)
        .where(DailyStock.menu_item_id.in_(item_ids), DailyStock.service_date == service_date)
        .order_by(DailyStock.menu_item_id)
        .with_for_update()
    )
    return {row.menu_item_id: row for row in rows}


def _lock_one_stock(db: Session, item_id: UUID, service_date) -> DailyStock | None:
    return db.scalar(
        select(DailyStock)
        .where(DailyStock.menu_item_id == item_id, DailyStock.service_date == service_date)
        .with_for_update()
    )


def _count_tasks(db: Session, station_id: UUID, status: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(PreparationTask)
            .where(
                PreparationTask.kitchen_station_id == station_id,
                PreparationTask.status == status,
            )
        )
        or 0
    )


def _average(samples: list[float]) -> int | None:
    if not samples:
        return None
    return int(sum(samples) / len(samples))


def _seconds(value: datetime | None) -> int | None:
    if value is None:
        return None
    return int(value.timestamp())


def _emit(order: Order, event_type: str) -> None:
    publish_kitchen_event(
        canteen_id=order.canteen_id,
        order_id=order.id,
        event_type=event_type,
        version=order.version,
    )
