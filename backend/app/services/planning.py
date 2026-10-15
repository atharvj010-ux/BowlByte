"""Preparation recommendations.

Approving a plan records an intention. It does not create a batch, change an
order, take payment, or touch daily stock. Simulations are not stored.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.foodintel.core import ItemNeed, allocate
from app.models.identity import User
from app.models.intelligence import (
    DemandForecastValue,
    FoodProductionBatch,
    PreparationPlan,
    PreparationPlanEvent,
    PreparationPlanItem,
)
from app.models.ordering import (
    DailyStock,
    KitchenStation,
    MenuItem,
    MenuItemStationAssignment,
    Order,
    OrderItem,
    PreparationTask,
)
from app.services.forecasting import latest_complete_run
from app.services.identity import _audit as audit
from app.services.ordering import manager_canteen_id

OPEN = ("PLACED", "ACCEPTED", "QUEUED", "PREPARING", "READY")
OBJECTIVE = (
    "Prefer covering confirmed uncollected orders, then forecast demand, "
    "without exceeding station minutes. Shortage is weighted more than extra portions. "
    "Weights are planning preferences, not measured costs."
)


def _needs(
    db: Session,
    canteen_id: UUID,
    service_date,
    *,
    forecast: dict[UUID, int | None],
    demand_factor: float,
    buffer_ratio: float,
    window_seconds: int,
    capacity_overrides: dict[str, int],
    unavailable: set[UUID],
) -> list[ItemNeed]:
    items = list(
        db.scalars(
            select(MenuItem).where(MenuItem.canteen_id == canteen_id, MenuItem.is_active.is_(True))
        )
    )
    stations = {
        row.menu_item_id: row.station_id
        for row in db.scalars(
            select(MenuItemStationAssignment).where(
                MenuItemStationAssignment.menu_item_id.in_(
                    [item.id for item in items] or [UUID(int=0)]
                )
            )
        )
    }
    station_rows = {
        row.id: row
        for row in db.scalars(select(KitchenStation).where(KitchenStation.canteen_id == canteen_id))
    }
    confirmed = dict(
        db.execute(
            select(OrderItem.menu_item_id, func.coalesce(func.sum(OrderItem.quantity), 0))
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                Order.canteen_id == canteen_id,
                Order.service_date == service_date,
                Order.status.in_(OPEN),
            )
            .group_by(OrderItem.menu_item_id)
        ).all()
    )
    usable = dict(
        db.execute(
            select(
                FoodProductionBatch.menu_item_id,
                func.coalesce(func.sum(FoodProductionBatch.remaining_qty), 0),
            )
            .where(
                FoodProductionBatch.canteen_id == canteen_id,
                FoodProductionBatch.service_date == service_date,
                FoodProductionBatch.source == "REAL",
            )
            .group_by(FoodProductionBatch.menu_item_id)
        ).all()
    )
    produced = dict(
        db.execute(
            select(
                FoodProductionBatch.menu_item_id,
                func.coalesce(func.sum(FoodProductionBatch.produced_qty), 0),
            )
            .where(
                FoodProductionBatch.canteen_id == canteen_id,
                FoodProductionBatch.service_date == service_date,
                FoodProductionBatch.source == "REAL",
            )
            .group_by(FoodProductionBatch.menu_item_id)
        ).all()
    )
    approved = dict(
        db.execute(
            select(
                PreparationPlanItem.menu_item_id,
                func.coalesce(
                    func.sum(
                        func.coalesce(
                            PreparationPlanItem.override_qty,
                            PreparationPlanItem.recommended_additional_qty,
                        )
                    ),
                    0,
                ),
            )
            .join(PreparationPlan, PreparationPlan.id == PreparationPlanItem.plan_id)
            .where(
                PreparationPlan.canteen_id == canteen_id,
                PreparationPlan.service_date == service_date,
                PreparationPlan.status == "APPROVED",
            )
            .group_by(PreparationPlanItem.menu_item_id)
        ).all()
    )
    workload = dict(
        db.execute(
            select(
                PreparationTask.kitchen_station_id,
                func.coalesce(func.sum(PreparationTask.expected_duration_seconds), 0),
            )
            .join(Order, Order.id == PreparationTask.order_id)
            .where(
                PreparationTask.canteen_id == canteen_id,
                Order.service_date == service_date,
                PreparationTask.status.in_(("QUEUED", "IN_PROGRESS")),
            )
            .group_by(PreparationTask.kitchen_station_id)
        ).all()
    )
    needs = []
    for item in items:
        if item.id in unavailable:
            forecast_qty = None
            confirmed_qty = 0
        else:
            raw = forecast.get(item.id)
            forecast_qty = None if raw is None else max(0, int(round(raw * demand_factor)))
            confirmed_qty = int(confirmed.get(item.id, 0))
        station_id = stations.get(item.id)
        station = station_rows.get(station_id) if station_id else None
        override = capacity_overrides.get(str(station_id)) if station_id else None
        capacity = 0 if station is None or not station.is_active else station.parallel_capacity
        if override is not None:
            capacity = override
        scheduled = max(0, int(approved.get(item.id, 0)) - int(produced.get(item.id, 0)))
        needs.append(
            ItemNeed(
                item_id=str(item.id),
                name=item.name,
                forecast_qty=forecast_qty,
                confirmed=confirmed_qty,
                usable=int(usable.get(item.id, 0)),
                scheduled=scheduled,
                buffer_ratio=buffer_ratio,
                prep_seconds=item.prep_seconds,
                station_id=str(station_id) if station_id else None,
                station_name=station.name if station else "No station",
                station_capacity=capacity,
                station_active=bool(station and station.is_active and capacity > 0),
                workload_seconds=int(workload.get(station_id, 0)) if station_id else 0,
                window_seconds=window_seconds,
            )
        )
    return needs


def _forecast_map(db: Session, run_id: UUID | None, service_date) -> dict[UUID, int | None]:
    if run_id is None:
        return {}
    rows = db.scalars(
        select(DemandForecastValue).where(
            DemandForecastValue.run_id == run_id,
            DemandForecastValue.service_date == service_date,
        )
    )
    return {row.menu_item_id: row.predicted_qty for row in rows}


def _stock_fingerprint(db: Session, canteen_id: UUID) -> int:
    total = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    DailyStock.available_qty + DailyStock.reserved_qty + DailyStock.consumed_qty
                ),
                0,
            )
        )
        .join(MenuItem, MenuItem.id == DailyStock.menu_item_id)
        .where(MenuItem.canteen_id == canteen_id)
    )
    return int(total or 0)


def simulate(
    db: Session,
    *,
    manager: User,
    service_date,
    run_id: UUID | None,
    demand_factor: float,
    buffer_ratio: float | None,
    window_seconds: int | None,
    capacity_overrides: dict[str, int],
    unavailable: list[UUID],
) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    if not 0.5 <= demand_factor <= 2:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Demand factor must be between 0.5 and 2.",
            status_code=422,
        )
    settings = get_settings()
    before = _stock_fingerprint(db, canteen_id)
    chosen = run_id
    if chosen is None:
        latest = latest_complete_run(db, canteen_id)
        chosen = latest.id if latest else None
    needs = _needs(
        db,
        canteen_id,
        service_date,
        forecast=_forecast_map(db, chosen, service_date),
        demand_factor=demand_factor,
        buffer_ratio=settings.planning_buffer_ratio if buffer_ratio is None else buffer_ratio,
        window_seconds=window_seconds or settings.planning_window_seconds,
        capacity_overrides=capacity_overrides,
        unavailable=set(unavailable),
    )
    plans, solver = allocate(needs)
    after = _stock_fingerprint(db, canteen_id)
    if after != before:
        raise ApiError(
            code="INTERNAL_ERROR",
            message="A simulation changed stock.",
            status_code=500,
        )
    return {
        "simulation": True,
        "solver": solver,
        "service_date": service_date.isoformat(),
        "forecast_run_id": str(chosen) if chosen else None,
        "objective": OBJECTIVE,
        "label": "Estimate. Nothing was saved and no stock moved.",
        "items": [_item_dict(row) for row in plans],
        "stock_unchanged": after == before,
    }


def _item_dict(row) -> dict:
    return {
        "menu_item_id": row.item_id,
        "forecast_qty": row.forecast_qty,
        "confirmed_unfulfilled_qty": row.confirmed,
        "usable_prepared_qty": row.usable,
        "scheduled_qty": row.scheduled,
        "buffer_qty": row.buffer_qty,
        "target_qty": row.target_qty,
        "recommended_additional_qty": row.recommended,
        "feasible_qty": row.feasible,
        "unmet_qty": row.unmet,
        "station_id": row.station_id,
        "duration_seconds": row.duration_seconds,
        "capacity_limited": row.capacity_limited,
        "explanation": row.explanation,
    }


def generate_plan(
    db: Session,
    *,
    manager: User,
    service_date,
    run_id: UUID | None,
    idempotency_key: str,
) -> tuple[dict, bool]:
    canteen_id = manager_canteen_id(db, manager)
    existing = db.scalar(
        select(PreparationPlan).where(
            PreparationPlan.canteen_id == canteen_id,
            PreparationPlan.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return _plan_payload(db, existing), True
    if run_id is None:
        latest = latest_complete_run(db, canteen_id)
        run_id = latest.id if latest else None
    settings = get_settings()
    needs = _needs(
        db,
        canteen_id,
        service_date,
        forecast=_forecast_map(db, run_id, service_date),
        demand_factor=1,
        buffer_ratio=settings.planning_buffer_ratio,
        window_seconds=settings.planning_window_seconds,
        capacity_overrides={},
        unavailable=set(),
    )
    rows, solver = allocate(needs)
    plan = PreparationPlan(
        canteen_id=canteen_id,
        forecast_run_id=run_id,
        service_date=service_date,
        status="DRAFT",
        solver=solver,
        objective_note=OBJECTIVE,
        input_snapshot={
            "forecast_run_id": str(run_id) if run_id else None,
            "buffer_ratio": settings.planning_buffer_ratio,
            "window_seconds": settings.planning_window_seconds,
            "shortage_weight": settings.planning_shortage_weight,
            "overproduction_weight": settings.planning_overproduction_weight,
        },
        idempotency_key=idempotency_key,
        created_by=manager.id,
    )
    db.add(plan)
    db.flush()
    for row in rows:
        db.add(
            PreparationPlanItem(
                plan_id=plan.id,
                menu_item_id=UUID(row.item_id),
                forecast_qty=row.forecast_qty,
                confirmed_unfulfilled_qty=row.confirmed,
                usable_prepared_qty=row.usable,
                scheduled_qty=row.scheduled,
                buffer_qty=row.buffer_qty,
                target_qty=row.target_qty,
                recommended_additional_qty=row.recommended,
                feasible_qty=row.feasible,
                unmet_qty=row.unmet,
                station_id=UUID(row.station_id) if row.station_id else None,
                duration_seconds=row.duration_seconds,
                capacity_limited=row.capacity_limited,
                explanation=row.explanation,
            )
        )
    db.add(
        PreparationPlanEvent(
            plan_id=plan.id, event_type="CREATED", actor_user_id=manager.id, reason="Generated"
        )
    )
    audit(
        db,
        action="plan.created",
        actor_user_id=manager.id,
        target_type="preparation_plan",
        target_id=str(plan.id),
        canteen_id=canteen_id,
        metadata={"service_date": service_date.isoformat()},
    )
    db.commit()
    return _plan_payload(db, plan), False


def _plan_payload(db: Session, plan: PreparationPlan) -> dict:
    items = db.scalars(select(PreparationPlanItem).where(PreparationPlanItem.plan_id == plan.id))
    events = db.scalars(
        select(PreparationPlanEvent)
        .where(PreparationPlanEvent.plan_id == plan.id)
        .order_by(PreparationPlanEvent.created_at)
    )
    return {
        "id": str(plan.id),
        "service_date": plan.service_date.isoformat(),
        "status": plan.status,
        "solver": plan.solver,
        "objective": plan.objective_note,
        "forecast_run_id": str(plan.forecast_run_id) if plan.forecast_run_id else None,
        "decision_reason": plan.decision_reason,
        "input_snapshot": plan.input_snapshot,
        "items": [
            {
                "menu_item_id": str(row.menu_item_id),
                "forecast_qty": row.forecast_qty,
                "confirmed_unfulfilled_qty": row.confirmed_unfulfilled_qty,
                "usable_prepared_qty": row.usable_prepared_qty,
                "scheduled_qty": row.scheduled_qty,
                "buffer_qty": row.buffer_qty,
                "target_qty": row.target_qty,
                "recommended_additional_qty": row.recommended_additional_qty,
                "feasible_qty": row.feasible_qty,
                "unmet_qty": row.unmet_qty,
                "capacity_limited": row.capacity_limited,
                "explanation": row.explanation,
                "override_qty": row.override_qty,
                "override_reason": row.override_reason,
            }
            for row in items
        ],
        "events": [
            {
                "event_type": event.event_type,
                "reason": event.reason,
                "created_at": event.created_at.isoformat(),
            }
            for event in events
        ],
    }


def list_plans(db: Session, *, manager: User, limit: int) -> list[dict]:
    canteen_id = manager_canteen_id(db, manager)
    rows = db.scalars(
        select(PreparationPlan)
        .where(PreparationPlan.canteen_id == canteen_id)
        .order_by(PreparationPlan.created_at.desc())
        .limit(limit)
    )
    return [
        {
            "id": str(row.id),
            "service_date": row.service_date.isoformat(),
            "status": row.status,
            "solver": row.solver,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


def get_plan(db: Session, *, manager: User, plan_id: UUID) -> dict:
    plan = _owned(db, manager, plan_id)
    return _plan_payload(db, plan)


def _owned(db: Session, manager: User, plan_id: UUID) -> PreparationPlan:
    canteen_id = manager_canteen_id(db, manager)
    plan = db.scalar(
        select(PreparationPlan)
        .where(PreparationPlan.id == plan_id, PreparationPlan.canteen_id == canteen_id)
        .with_for_update()
    )
    if plan is None:
        raise ApiError(code="NOT_FOUND", message="Plan not found.", status_code=404)
    return plan


def override_item(
    db: Session, *, manager: User, plan_id: UUID, menu_item_id: UUID, quantity: int, reason: str
) -> dict:
    if not 0 <= quantity <= 5000 or len(reason.strip()) < 3:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Check the quantity and the reason.",
            status_code=422,
        )
    plan = _owned(db, manager, plan_id)
    if plan.status != "DRAFT":
        raise ApiError(code="CONFLICT", message="Only a draft plan can be edited.", status_code=409)
    item = db.scalar(
        select(PreparationPlanItem).where(
            PreparationPlanItem.plan_id == plan.id, PreparationPlanItem.menu_item_id == menu_item_id
        )
    )
    if item is None:
        raise ApiError(code="NOT_FOUND", message="That item is not on the plan.", status_code=404)
    item.override_qty = quantity
    item.override_reason = reason[:300]
    db.add(
        PreparationPlanEvent(
            plan_id=plan.id, event_type="ADJUSTED", actor_user_id=manager.id, reason=reason[:300]
        )
    )
    db.commit()
    return _plan_payload(db, plan)


def decide(db: Session, *, manager: User, plan_id: UUID, approve: bool, reason: str) -> dict:
    if len(reason.strip()) < 3:
        raise ApiError(code="VALIDATION_ERROR", message="Give a short reason.", status_code=422)
    plan = _owned(db, manager, plan_id)
    if plan.status in ("APPROVED", "REJECTED"):
        return _plan_payload(db, plan)
    if plan.status != "DRAFT":
        raise ApiError(
            code="CONFLICT",
            message="This plan can no longer be decided.",
            status_code=409,
        )
    canteen_id = plan.canteen_id
    if approve:
        current = db.scalars(
            select(PreparationPlan)
            .where(
                PreparationPlan.canteen_id == canteen_id,
                PreparationPlan.service_date == plan.service_date,
                PreparationPlan.status == "APPROVED",
                PreparationPlan.id != plan.id,
            )
            .with_for_update()
        )
        for other in current:
            other.status = "SUPERSEDED"
            other.superseded_by = plan.id
            db.add(
                PreparationPlanEvent(
                    plan_id=other.id,
                    event_type="SUPERSEDED",
                    actor_user_id=manager.id,
                    reason=f"Replaced by {plan.id}",
                )
            )
        plan.status = "APPROVED"
        event = "APPROVED"
    else:
        plan.status = "REJECTED"
        event = "REJECTED"
    plan.decided_by = manager.id
    plan.decided_at = datetime.now(UTC)
    plan.decision_reason = reason[:300]
    db.add(
        PreparationPlanEvent(
            plan_id=plan.id, event_type=event, actor_user_id=manager.id, reason=reason[:300]
        )
    )
    audit(
        db,
        action=f"plan.{event.lower()}",
        actor_user_id=manager.id,
        target_type="preparation_plan",
        target_id=str(plan.id),
        canteen_id=canteen_id,
        metadata={"service_date": plan.service_date.isoformat()},
    )
    db.commit()
    return _plan_payload(db, plan)


def stock_unchanged_guard(before: int, after: int) -> None:
    if before != after:
        raise ApiError(
            code="INTERNAL_ERROR",
            message="Planning changed saleable stock.",
            status_code=500,
        )
