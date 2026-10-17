"""Manager-only production, waste, forecast, and planning routes."""

from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_principal
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.fulfillment import CashReceipt, CashReversal
from app.models.intelligence import ForecastingModel
from app.models.ordering import Order
from app.schemas.intelligence import (
    ClosureWrite,
    DemoSeed,
    ForecastRequest,
    PlanDecision,
    PlanOverride,
    PlanRequest,
    ProductionAdjust,
    ProductionCreate,
    SimulateRequest,
    TrainRequest,
    WasteCreate,
)
from app.services.demand import history, history_csv
from app.services.forecasting import (
    activate_model,
    enqueue_training,
    generate_forecast,
    get_job,
    get_run,
    list_models,
    list_runs,
    seed_demo,
)
from app.services.identity import Principal
from app.services.ordering import manager_canteen_id
from app.services.planning import (
    decide,
    generate_plan,
    get_plan,
    list_plans,
    override_item,
    simulate,
)
from app.services.production import (
    adjust_batch,
    create_batch,
    get_batch,
    list_batches,
    list_waste,
    local_today,
    reconciliation,
    record_waste,
    set_closure,
)
from app.services.rate_limit import consume_allowance

router = APIRouter(tags=["intelligence"])


def _manager(principal: Principal = Depends(require_principal)) -> Principal:
    if principal.user.role != "CANTEEN_MANAGER":
        raise ApiError(
            code="FORBIDDEN",
            message="Only a canteen manager can do this.",
            status_code=403,
        )
    return principal


def _write(principal: Principal = Depends(require_csrf)) -> Principal:
    return _manager(principal)


def _dates(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    end = date_to or local_today()
    start = date_from or (end - timedelta(days=13))
    if start > end or (end - start).days > 366:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Choose a range of at most one year.",
            status_code=422,
        )
    return start, end


@router.get("/admin/production")
def production_list(
    date_from: date | None = None,
    date_to: date | None = None,
    menu_item_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    start, end = _dates(date_from, date_to)
    return list_batches(
        db,
        manager=principal.user,
        date_from=start,
        date_to=end,
        menu_item_id=menu_item_id,
        limit=limit,
        offset=offset,
    )


@router.post("/admin/production", status_code=201)
def production_create(
    body: ProductionCreate,
    principal: Principal = Depends(_write),
    db: Session = Depends(get_db),
) -> dict:
    payload, replayed = create_batch(db, manager=principal.user, **body.model_dump())
    payload["replayed"] = replayed
    return payload


@router.get("/admin/production/reconciliation")
def production_reconciliation(
    service_date: date,
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    return reconciliation(db, manager=principal.user, service_date=service_date)


@router.get("/admin/production/{batch_id}")
def production_detail(
    batch_id: UUID,
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    return get_batch(db, manager=principal.user, batch_id=batch_id)


@router.post("/admin/production/{batch_id}/adjust")
def production_adjust(
    batch_id: UUID,
    body: ProductionAdjust,
    principal: Principal = Depends(_write),
    db: Session = Depends(get_db),
) -> dict:
    payload, replayed = adjust_batch(
        db,
        manager=principal.user,
        batch_id=batch_id,
        **body.model_dump(),
    )
    payload["replayed"] = replayed
    return payload


@router.get("/admin/waste")
def waste_list(
    date_from: date | None = None,
    date_to: date | None = None,
    menu_item_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    start, end = _dates(date_from, date_to)
    return list_waste(
        db,
        manager=principal.user,
        date_from=start,
        date_to=end,
        menu_item_id=menu_item_id,
        limit=limit,
        offset=offset,
    )


@router.post("/admin/waste", status_code=201)
def waste_create(
    body: WasteCreate,
    principal: Principal = Depends(_write),
    db: Session = Depends(get_db),
) -> dict:
    payload, replayed = record_waste(db, manager=principal.user, **body.model_dump())
    payload["replayed"] = replayed
    return payload


@router.post("/admin/closures")
def closures(
    body: ClosureWrite, principal: Principal = Depends(_write), db: Session = Depends(get_db)
) -> dict:
    return set_closure(
        db,
        manager=principal.user,
        service_date=body.service_date,
        note=body.note,
        closed=body.closed,
    )


@router.get("/admin/intelligence/demand-history")
def demand_history(
    date_from: date | None = None,
    date_to: date | None = None,
    source: str = Query(default="REAL", pattern="^(REAL|DEMO)$"),
    export: str | None = None,
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
):
    start, end = _dates(date_from, date_to)
    rows = history(db, manager=principal.user, date_from=start, date_to=end, source=source)
    if export == "csv":
        return PlainTextResponse(
            history_csv(rows),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=bowlbyte-demand.csv"},
        )
    return {
        "source": source,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "rows": [
            {
                **row,
                "service_date": row["service_date"].isoformat(),
                "menu_item_id": str(row["menu_item_id"]),
            }
            for row in rows
        ],
    }


@router.get("/admin/intelligence/overview")
def overview(
    date_from: date | None = None,
    date_to: date | None = None,
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    start, end = _dates(date_from, date_to)
    canteen_id = manager_canteen_id(db, principal.user)
    rows = history(db, manager=principal.user, date_from=start, date_to=end, source="REAL")
    orders = int(
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(
                Order.canteen_id == canteen_id,
                Order.service_date >= start,
                Order.service_date <= end,
            )
        )
        or 0
    )
    picked = sum(row["qty_picked_up"] or 0 for row in rows)
    produced = sum(row["produced_qty"] for row in rows)
    discarded = sum(row["discarded_qty"] for row in rows)
    gross = int(
        db.scalar(
            select(func.coalesce(func.sum(CashReceipt.amount_paise), 0)).where(
                CashReceipt.canteen_id == canteen_id,
                func.date(CashReceipt.received_at) >= start,
                func.date(CashReceipt.received_at) <= end,
            )
        )
        or 0
    )
    reversed_paise = int(
        db.scalar(
            select(func.coalesce(func.sum(CashReversal.amount_paise), 0)).where(
                CashReversal.canteen_id == canteen_id,
                func.date(CashReversal.reversed_at) >= start,
                func.date(CashReversal.reversed_at) <= end,
            )
        )
        or 0
    )
    active = db.scalar(
        select(ForecastingModel).where(
            ForecastingModel.canteen_id == canteen_id, ForecastingModel.status == "ACTIVE"
        )
    )
    top: dict[str, int] = {}
    for row in rows:
        top[row["item_name"]] = top.get(row["item_name"], 0) + int(row["qty_ordered"] or 0)
    ranking = sorted(top.items(), key=lambda pair: pair[1], reverse=True)[:5]
    return {
        "source": "REAL",
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "orders": orders,
        "picked_up_portions": picked,
        "produced_portions": produced,
        "discarded_portions": discarded,
        "waste_ratio": None if produced == 0 else round(discarded / produced, 4),
        "cash_recorded_paise": gross - reversed_paise,
        "cash_note": "Cash recorded at the counter, minus reversals. Not a till count.",
        "cancelled_portions": sum(row["qty_cancelled"] for row in rows),
        "rejected_portions": sum(row["qty_rejected"] for row in rows),
        "top_items": [{"name": name, "qty_ordered": qty} for name, qty in ranking],
        "active_model": None
        if active is None
        else {"id": str(active.id), "algorithm": active.algorithm, "source": active.source},
        "data_quality": {
            "observed_rows": sum(1 for row in rows if row["quality"] == "OBSERVED"),
            "censored_rows": sum(1 for row in rows if row["censored"]),
            "closed_rows": sum(1 for row in rows if row["closed"]),
        },
        "by_day": _by_day(rows),
    }


def _by_day(rows: list[dict]) -> list[dict]:
    days: dict[str, dict] = {}
    for row in rows:
        key = row["service_date"].isoformat()
        bucket = days.setdefault(
            key,
            {"service_date": key, "ordered": 0, "picked_up": 0, "produced": 0, "discarded": 0},
        )
        bucket["ordered"] += int(row["qty_ordered"] or 0)
        bucket["picked_up"] += int(row["qty_picked_up"] or 0)
        bucket["produced"] += int(row["produced_qty"] or 0)
        bucket["discarded"] += int(row["discarded_qty"] or 0)
    return [days[key] for key in sorted(days)]


@router.get("/admin/intelligence/waste-history")
def waste_history(
    date_from: date | None = None,
    date_to: date | None = None,
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    start, end = _dates(date_from, date_to)
    rows = history(db, manager=principal.user, date_from=start, date_to=end, source="REAL")
    return {
        "source": "REAL",
        "note": (
            "Discarded portions are only what a manager recorded. "
            "Unsold food is not assumed to be waste."
        ),
        "rows": [
            {
                "service_date": row["service_date"].isoformat(),
                "item_name": row["item_name"],
                "produced_qty": row["produced_qty"],
                "discarded_qty": row["discarded_qty"],
            }
            for row in rows
            if row["discarded_qty"] or row["produced_qty"]
        ],
    }


@router.post("/admin/intelligence/demo-dataset", status_code=201)
def demo_dataset(
    body: DemoSeed, principal: Principal = Depends(_write), db: Session = Depends(get_db)
) -> dict:
    return seed_demo(db, manager=principal.user, days=body.days, seed=body.seed)


@router.post("/admin/forecasting/train", status_code=202)
def train(
    body: TrainRequest, principal: Principal = Depends(_write), db: Session = Depends(get_db)
) -> dict:
    consume_allowance(
        bucket="forecast-train",
        value=str(principal.user.id),
        limit=4,
        window_seconds=60 * 60,
        unavailable_message="Training is temporarily unavailable.",
        limited_message="Too many training requests. Wait and try again.",
    )
    payload, replayed = enqueue_training(
        db,
        manager=principal.user,
        source=body.source,
        idempotency_key=body.idempotency_key,
    )
    payload["replayed"] = replayed
    return payload


@router.get("/admin/forecasting/jobs/{job_id}")
def training_job(
    job_id: UUID, principal: Principal = Depends(_manager), db: Session = Depends(get_db)
) -> dict:
    return get_job(db, manager=principal.user, job_id=job_id)


@router.get("/admin/forecasts/models")
def models(principal: Principal = Depends(_manager), db: Session = Depends(get_db)) -> dict:
    return {"models": list_models(db, manager=principal.user)}


@router.post("/admin/forecasts/models/{model_id}/activate")
def activate(
    model_id: UUID, principal: Principal = Depends(_write), db: Session = Depends(get_db)
) -> dict:
    return activate_model(db, manager=principal.user, model_id=model_id)


@router.get("/admin/forecasts/evaluations")
def evaluations(principal: Principal = Depends(_manager), db: Session = Depends(get_db)) -> dict:
    models_payload = list_models(db, manager=principal.user)
    return {
        "note": (
            "DEMO and REAL evaluations are separate. A demo score is not real canteen accuracy."
        ),
        "models": models_payload,
    }


@router.post("/admin/forecasts/generate", status_code=201)
def forecast_generate(
    body: ForecastRequest, principal: Principal = Depends(_write), db: Session = Depends(get_db)
) -> dict:
    payload, replayed = generate_forecast(
        db,
        manager=principal.user,
        source=body.source,
        horizon_days=body.horizon_days,
        idempotency_key=body.idempotency_key,
    )
    payload["replayed"] = replayed
    return payload


@router.get("/admin/forecasts")
def forecasts(
    limit: int = Query(default=20, ge=1, le=50),
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    return {"runs": list_runs(db, manager=principal.user, limit=limit)}


@router.get("/admin/forecasts/{run_id}")
def forecast_detail(
    run_id: UUID, principal: Principal = Depends(_manager), db: Session = Depends(get_db)
) -> dict:
    return get_run(db, manager=principal.user, run_id=run_id)


@router.post("/admin/planning/generate", status_code=201)
def planning_generate(
    body: PlanRequest, principal: Principal = Depends(_write), db: Session = Depends(get_db)
) -> dict:
    payload, replayed = generate_plan(
        db,
        manager=principal.user,
        service_date=body.service_date,
        run_id=body.forecast_run_id,
        idempotency_key=body.idempotency_key,
    )
    payload["replayed"] = replayed
    return payload


@router.get("/admin/planning")
def planning_list(
    limit: int = Query(default=20, ge=1, le=50),
    principal: Principal = Depends(_manager),
    db: Session = Depends(get_db),
) -> dict:
    return {"plans": list_plans(db, manager=principal.user, limit=limit)}


@router.get("/admin/planning/{plan_id}")
def planning_detail(
    plan_id: UUID, principal: Principal = Depends(_manager), db: Session = Depends(get_db)
) -> dict:
    return get_plan(db, manager=principal.user, plan_id=plan_id)


@router.post("/admin/planning/{plan_id}/override")
def planning_override(
    plan_id: UUID,
    body: PlanOverride,
    principal: Principal = Depends(_write),
    db: Session = Depends(get_db),
) -> dict:
    return override_item(
        db,
        manager=principal.user,
        plan_id=plan_id,
        menu_item_id=body.menu_item_id,
        quantity=body.quantity,
        reason=body.reason,
    )


@router.post("/admin/planning/{plan_id}/approve")
def planning_approve(
    plan_id: UUID,
    body: PlanDecision,
    principal: Principal = Depends(_write),
    db: Session = Depends(get_db),
) -> dict:
    return decide(db, manager=principal.user, plan_id=plan_id, approve=True, reason=body.reason)


@router.post("/admin/planning/{plan_id}/reject")
def planning_reject(
    plan_id: UUID,
    body: PlanDecision,
    principal: Principal = Depends(_write),
    db: Session = Depends(get_db),
) -> dict:
    return decide(db, manager=principal.user, plan_id=plan_id, approve=False, reason=body.reason)


@router.post("/admin/planning/simulate")
def planning_simulate(
    body: SimulateRequest, principal: Principal = Depends(_write), db: Session = Depends(get_db)
) -> dict:
    overrides = {str(station_id): 0 for station_id in body.inactive_station_ids}
    return simulate(
        db,
        manager=principal.user,
        service_date=body.service_date,
        run_id=body.forecast_run_id,
        demand_factor=body.demand_factor,
        buffer_ratio=body.buffer_ratio,
        window_seconds=body.window_seconds,
        capacity_overrides=overrides,
        unavailable=body.unavailable_item_ids,
    )
