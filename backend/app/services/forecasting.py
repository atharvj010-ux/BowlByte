"""Train, evaluate, and generate demand forecasts.

Training runs in the worker, never inside the HTTP request. Artifacts are
joblib files written by this process. Loading checks the path and the SHA-256
stored at training time. An untrusted pickle can execute code, so nothing
uploaded by a client is loaded.
"""

from __future__ import annotations

import hashlib
import random
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from uuid import UUID

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import SessionLocal
from app.foodintel.core import (
    FEATURE_NAMES,
    ML_IMPROVEMENT,
    Observation,
    as_millis,
    baseline_quantity,
    feature_row,
    history_before,
    next_open_days,
    portions,
    residual_band,
    score_forecasts,
    trainable,
)
from app.models.identity import User
from app.models.intelligence import (
    CanteenClosure,
    DemandForecastRun,
    DemandForecastValue,
    DemoDemandDay,
    ForecastingModel,
    ForecastJob,
    ModelEvaluation,
)
from app.models.ordering import MenuItem
from app.services.demand import demo_history, real_history, to_observations
from app.services.ordering import manager_canteen_id
from app.services.rate_limit import assert_allowance, record_attempt

BUSY = "Forecasting is busy. Wait a few minutes and try again."


def utcnow() -> datetime:
    return datetime.now(UTC)


def _root() -> Path:
    configured = Path(get_settings().forecast_artifact_dir)
    root = (
        configured if configured.is_absolute() else Path(__file__).resolve().parents[2] / configured
    )
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _save_artifact(model_id: UUID, estimator) -> tuple[str, str]:
    import joblib

    path = (_root() / f"{model_id}.joblib").resolve()
    if path.parent != _root():
        raise RuntimeError("artifact path escaped the store")
    joblib.dump({"estimator": estimator, "features": list(FEATURE_NAMES)}, path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return str(path), digest


def _load_artifact(path: str, digest: str):
    import joblib

    resolved = Path(path).resolve()
    if resolved.parent != _root():
        raise ApiError(
            code="CONFLICT",
            message="Forecast artifact is not in the trusted store.",
            status_code=409,
        )
    actual = hashlib.sha256(resolved.read_bytes()).hexdigest()
    if actual != digest:
        raise ApiError(
            code="CONFLICT",
            message="Forecast artifact failed its integrity check.",
            status_code=409,
        )
    payload = joblib.load(resolved)
    if not isinstance(payload, dict) or "estimator" not in payload:
        raise ApiError(
            code="CONFLICT",
            message="Forecast artifact has an unexpected shape.",
            status_code=409,
        )
    return payload["estimator"]


def _span(rows: list[Observation]) -> tuple[date, date]:
    days = [row.day for row in rows]
    return min(days), max(days)


def _load_rows(db: Session, canteen_id: UUID, source: str) -> list[Observation]:
    if source == "DEMO":
        found = demo_history(db, canteen_id, date(2000, 1, 1), date(2100, 1, 1))
    else:
        found = real_history(db, canteen_id, date(2000, 1, 1), date(2100, 1, 1))
    return found and to_observations(found) or []


def _by_item(rows: list[Observation]) -> dict[str, list[Observation]]:
    grouped: dict[str, list[Observation]] = defaultdict(list)
    for row in rows:
        grouped[row.item_id].append(row)
    return grouped


def _closed_dates(rows: list[Observation]) -> set[date]:
    return {row.day for row in rows if row.closed}


def _predict_baseline(rows: list[Observation], item_id: str, target: date) -> int | None:
    settings = get_settings()
    history = history_before(rows, item_id, target)
    return baseline_quantity(history, target, settings.forecast_min_baseline_days)


def _fit_ml(rows: list[Observation], before: date):
    from sklearn.ensemble import HistGradientBoostingRegressor

    settings = get_settings()
    features: list[list[float]] = []
    targets: list[float] = []
    for item_id, group in _by_item(rows).items():
        usable = trainable(group)
        for row in usable:
            if row.day >= before:
                continue
            vector = feature_row(
                history_before(rows, item_id, row.day),
                row.day,
                settings.forecast_min_baseline_days,
            )
            if vector is None:
                continue
            features.append(vector)
            targets.append(float(row.qty))
    if len(features) < settings.forecast_min_ml_days:
        return None
    model = HistGradientBoostingRegressor(
        max_iter=80,
        learning_rate=0.08,
        max_depth=4,
        random_state=settings.forecast_seed,
    )
    model.fit(np.array(features), np.array(targets))
    return model


def _predict_ml(model, rows: list[Observation], item_id: str, target: date) -> int | None:
    vector = feature_row(
        history_before(rows, item_id, target), target, get_settings().forecast_min_baseline_days
    )
    if vector is None or model is None:
        return None
    return portions(float(model.predict(np.array([vector]))[0]))


def _pairs(rows, days: list[date], predict) -> list[tuple[float, float, str, date]]:
    found = []
    lookup = {(row.item_id, row.day): row for row in trainable(rows)}
    for item_id in {row.item_id for row in rows}:
        for day in days:
            actual = lookup.get((item_id, day))
            if actual is None:
                continue
            pred = predict(item_id, day)
            if pred is None:
                continue
            found.append((float(pred), float(actual.qty), item_id, day))
    return found


def _store_eval(db: Session, model_id: UUID, role: str, score, horizon: int) -> None:
    if score is None:
        return
    db.add(
        ModelEvaluation(
            model_id=model_id,
            role=role,
            horizon_days=horizon,
            mae=as_millis(score.mae) or 0,
            wape_millis=as_millis(score.wape),
            bias_millis=as_millis(score.bias) or 0,
            rmse_millis=as_millis(score.rmse) or 0,
            n_points=score.n_points,
            n_days=score.n_days,
            n_items=score.n_items,
        )
    )


def _versions() -> dict:
    import sklearn

    return {"scikit-learn": sklearn.__version__, "numpy": np.__version__}


def execute_training_job(job_id: UUID) -> None:
    db = SessionLocal()
    try:
        job = db.get(ForecastJob, job_id)
        if job is None or job.status != "PENDING":
            return
        job.status = "RUNNING"
        job.started_at = utcnow()
        db.commit()
        _train(db, job)
    except Exception:
        db.rollback()
        failed = db.get(ForecastJob, job_id)
        if failed is not None and failed.status != "SUCCEEDED":
            failed.status = "FAILED"
            failed.error = "Training failed before a model could be saved."
            failed.finished_at = utcnow()
            db.commit()
    finally:
        db.close()


def _train(db: Session, job: ForecastJob) -> None:
    settings = get_settings()
    rows = _load_rows(db, job.canteen_id, job.source)
    usable_days = sorted({row.day for row in trainable(rows)})
    cutoff = usable_days[-1] if usable_days else date.today()
    provenance = (
        f"{job.source} demand grouped by menu item and service date. "
        "Closed and stockout days are excluded from training targets. "
        f"Open days: {len(usable_days)}."
    )
    holdout = usable_days[-settings.forecast_holdout_days :]
    before_holdout = [day for day in usable_days if not holdout or day < holdout[0]]
    validation = before_holdout[-settings.forecast_holdout_days :]
    have_split = (
        len(usable_days) >= settings.forecast_min_ml_days
        and len(validation) >= 4
        and len(holdout) >= 4
    )

    def add_model(
        algorithm: str, metrics: dict, reason: str, recommended: bool, estimator=None
    ) -> ForecastingModel:
        model = ForecastingModel(
            canteen_id=job.canteen_id,
            algorithm=algorithm,
            version_label=f"{algorithm.lower()}-{cutoff.isoformat()}",
            status="CANDIDATE",
            source=job.source,
            training_cutoff=cutoff,
            dataset_provenance=provenance,
            feature_spec={
                "names": list(FEATURE_NAMES),
                "target": "observed portions per item per open day",
            },
            train_rows=metrics.get("train_rows", 0),
            valid_days=metrics.get("valid_days", 0),
            item_count=len({row.item_id for row in rows}),
            metrics=metrics,
            library_versions=_versions(),
            seed=settings.forecast_seed,
            selection_reason=reason,
            recommended=recommended,
            created_by=job.requested_by,
        )
        db.add(model)
        db.flush()
        if estimator is not None:
            path, digest = _save_artifact(model.id, estimator)
            model.artifact_path = path
            model.artifact_sha256 = digest
        return model

    if len(usable_days) < settings.forecast_min_baseline_days:
        model = add_model(
            "SEASONAL_NAIVE",
            {"status": "INSUFFICIENT_DATA", "open_days": len(usable_days)},
            (
                f"Need at least {settings.forecast_min_baseline_days} open days. "
                f"This canteen has {len(usable_days)}."
            ),
            False,
        )
        job.model_id = model.id
        job.status = "SUCCEEDED"
        job.finished_at = utcnow()
        db.commit()
        return

    def baseline_predict(item_id, day):
        return _predict_baseline(rows, item_id, day)

    val_base = score_forecasts(_pairs(rows, validation, baseline_predict)) if have_split else None
    hold_base = score_forecasts(_pairs(rows, holdout, baseline_predict)) if have_split else None
    base_metrics = {
        "validation_mae": None if val_base is None else val_base.mae,
        "holdout_mae": None if hold_base is None else hold_base.mae,
        "holdout_wape": None if hold_base is None else hold_base.wape,
        "open_days": len(usable_days),
        "train_rows": len(before_holdout),
        "valid_days": len(validation),
        "note": "Holdout was not used to choose the model.",
    }
    ml_model = None
    ml_better = False
    ml_reason = f"Need {settings.forecast_min_ml_days} open days before ML training."
    if have_split:
        origin = validation[0]
        fitted = _fit_ml(rows, origin)
        if fitted is not None:

            def ml_predict(item_id, day, fitted=fitted):
                return _predict_ml(fitted, rows, item_id, day)

            val_ml = score_forecasts(_pairs(rows, validation, ml_predict))
            hold_model = _fit_ml(rows, holdout[0])

            def hold_predict(item_id, day, model=hold_model):
                return _predict_ml(model, rows, item_id, day)

            hold_ml = score_forecasts(_pairs(rows, holdout, hold_predict)) if hold_model else None
            ml_better = (
                val_ml is not None
                and val_base is not None
                and val_ml.mae < val_base.mae * ML_IMPROVEMENT
            )
            ml_reason = (
                "Validation MAE improved on the baseline, so this candidate may be activated."
                if ml_better
                else (
                    "Validation MAE did not beat the baseline by a clear margin. "
                    "The baseline stays preferred."
                )
            )
            ml_model = add_model(
                "HIST_GRADIENT_BOOSTING",
                {
                    "validation_mae": None if val_ml is None else val_ml.mae,
                    "holdout_mae": None if hold_ml is None else hold_ml.mae,
                    "holdout_wape": None if hold_ml is None else hold_ml.wape,
                    "train_rows": len([row for row in trainable(rows) if row.day < origin]),
                    "valid_days": len(validation),
                    "open_days": len(usable_days),
                    "selection_used_holdout": False,
                },
                ml_reason,
                ml_better,
                estimator=hold_model or fitted,
            )
            _store_eval(db, ml_model.id, "VALIDATION", val_ml, len(validation))
            _store_eval(db, ml_model.id, "HOLDOUT", hold_ml, len(holdout))
        else:
            ml_reason = "Not enough feature rows to fit the gradient boosting model."
    base = add_model(
        "SEASONAL_NAIVE",
        base_metrics,
        (
            "Same-weekday median, with a recent-median fallback. "
            "Preferred unless an ML candidate wins on validation."
        ),
        not ml_better,
    )
    _store_eval(db, base.id, "VALIDATION", val_base, len(validation))
    _store_eval(db, base.id, "HOLDOUT", hold_base, len(holdout))
    job.model_id = (ml_model or base).id
    job.status = "SUCCEEDED"
    job.error = (
        None if have_split or len(usable_days) >= settings.forecast_min_baseline_days else ml_reason
    )
    job.finished_at = utcnow()
    db.commit()


def enqueue_training(
    db: Session, *, manager: User, source: str, idempotency_key: str
) -> tuple[dict, bool]:
    if source not in ("REAL", "DEMO"):
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Source must be REAL or DEMO.",
            status_code=422,
        )
    canteen_id = manager_canteen_id(db, manager)
    existing = db.scalar(
        select(ForecastJob).where(
            ForecastJob.canteen_id == canteen_id, ForecastJob.idempotency_key == idempotency_key
        )
    )
    if existing is not None:
        return _job_payload(existing), True
    settings = get_settings()
    assert_allowance(
        bucket="forecast-train",
        value=str(manager.id),
        limit=settings.intelligence_job_limit,
        unavailable_message=BUSY,
    )
    record_attempt(
        bucket="forecast-train",
        value=str(manager.id),
        window_seconds=settings.intelligence_job_window_seconds,
        unavailable_message=BUSY,
    )
    job = ForecastJob(
        canteen_id=canteen_id,
        source=source,
        status="PENDING",
        idempotency_key=idempotency_key,
        requested_by=manager.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    _kick(job.id)
    return _job_payload(job), False


def _kick(job_id: UUID) -> None:
    try:
        from app.worker import celery_app

        celery_app.send_task("bowlbyte.train_forecast", args=[str(job_id)], retry=False)
    except Exception:
        db = SessionLocal()
        job = db.get(ForecastJob, job_id)
        if job is not None and job.status == "PENDING":
            job.status = "FAILED"
            job.error = "The training queue was unavailable."
            job.finished_at = utcnow()
            db.commit()
        db.close()


def _job_payload(job: ForecastJob) -> dict:
    return {
        "id": str(job.id),
        "status": job.status,
        "source": job.source,
        "model_id": str(job.model_id) if job.model_id else None,
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


def get_job(db: Session, *, manager: User, job_id: UUID) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    job = db.get(ForecastJob, job_id)
    if job is None or job.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Training job not found.", status_code=404)
    return _job_payload(job)


def seed_demo(db: Session, *, manager: User, days: int, seed: int) -> dict:
    if not 30 <= days <= 120:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Demo history must cover 30 to 120 days.",
            status_code=422,
        )
    canteen_id = manager_canteen_id(db, manager)
    items = list(
        db.scalars(
            select(MenuItem)
            .where(MenuItem.canteen_id == canteen_id, MenuItem.is_active.is_(True))
            .limit(
                8,
            )
        )
    )
    if not items:
        raise ApiError(
            code="CONFLICT",
            message="Publish a menu item before loading demo history.",
            status_code=409,
        )
    rng = random.Random(seed)
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    db.execute(delete(DemoDemandDay).where(DemoDemandDay.canteen_id == canteen_id))
    count = 0
    for index, item in enumerate(items):
        base = 16 + index * 11
        for offset in range(days):
            day = start + timedelta(days=offset)
            closed = day.weekday() == 6
            factor = (0.75, 1.0, 1.05, 1.1, 1.25, 0.9, 0.0)[day.weekday()]
            observed = 0 if closed else max(0, int(base * factor) + rng.randint(-2, 3))
            censored = (not closed) and rng.random() < 0.05
            if censored:
                observed = observed // 2
            produced = 0 if closed else observed + rng.randint(0, 3)
            discarded = 0 if closed else min(produced, rng.randint(0, 2))
            db.add(
                DemoDemandDay(
                    canteen_id=canteen_id,
                    menu_item_id=item.id,
                    service_date=day,
                    observed_qty=observed,
                    produced_qty=produced,
                    discarded_qty=discarded,
                    censored=censored,
                    closed=closed,
                    seed=seed,
                )
            )
            count += 1
    db.commit()
    return {
        "source": "DEMO",
        "days": days,
        "rows": count,
        "items": len(items),
        "seed": seed,
        "note": (
            "Demo history is not real demand and is excluded from "
            "operational cash and production totals."
        ),
    }


def activate_model(db: Session, *, manager: User, model_id: UUID) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    model = db.get(ForecastingModel, model_id)
    if model is None or model.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Model not found.", status_code=404)
    if model.status == "FAILED":
        raise ApiError(
            code="CONFLICT",
            message="A failed model cannot be activated.",
            status_code=409,
        )
    others = db.scalars(
        select(ForecastingModel).where(
            ForecastingModel.canteen_id == canteen_id,
            ForecastingModel.source == model.source,
            ForecastingModel.status == "ACTIVE",
        )
    )
    for other in others:
        if other.id != model.id:
            other.status = "CANDIDATE"
    model.status = "ACTIVE"
    model.activated_at = utcnow()
    db.commit()
    return {
        "id": str(model.id),
        "status": model.status,
        "algorithm": model.algorithm,
        "source": model.source,
    }


def list_models(db: Session, *, manager: User) -> list[dict]:
    canteen_id = manager_canteen_id(db, manager)
    rows = db.scalars(
        select(ForecastingModel)
        .where(ForecastingModel.canteen_id == canteen_id)
        .order_by(ForecastingModel.created_at.desc())
        .limit(40)
    )
    result = []
    for row in rows:
        evals = db.scalars(select(ModelEvaluation).where(ModelEvaluation.model_id == row.id))
        result.append(
            {
                "id": str(row.id),
                "algorithm": row.algorithm,
                "status": row.status,
                "source": row.source,
                "recommended": row.recommended,
                "training_cutoff": row.training_cutoff.isoformat(),
                "selection_reason": row.selection_reason,
                "metrics": row.metrics,
                "created_at": row.created_at.isoformat(),
                "evaluations": [
                    {
                        "role": item.role,
                        "mae": item.mae / 1000,
                        "wape": None if item.wape_millis is None else item.wape_millis / 1000,
                        "bias": item.bias_millis / 1000,
                        "rmse": item.rmse_millis / 1000,
                        "n_points": item.n_points,
                        "n_days": item.n_days,
                        "n_items": item.n_items,
                    }
                    for item in evals
                ],
            }
        )
    return result


def generate_forecast(
    db: Session,
    *,
    manager: User,
    source: str,
    horizon_days: int,
    idempotency_key: str,
) -> tuple[dict, bool]:
    if source not in ("REAL", "DEMO") or horizon_days not in (1, 7):
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Check the source and horizon.",
            status_code=422,
        )
    canteen_id = manager_canteen_id(db, manager)
    existing = db.scalar(
        select(DemandForecastRun).where(
            DemandForecastRun.canteen_id == canteen_id,
            DemandForecastRun.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return _run_payload(db, existing), True
    rows = _load_rows(db, canteen_id, source)
    usable_days = sorted({row.day for row in trainable(rows)})
    cutoff = usable_days[-1] if usable_days else date.today() - timedelta(days=1)
    active = db.scalar(
        select(ForecastingModel).where(
            ForecastingModel.canteen_id == canteen_id,
            ForecastingModel.source == source,
            ForecastingModel.status == "ACTIVE",
        )
    )
    method = "BASELINE"
    estimator = None
    model_id = None
    if (
        active is not None
        and active.algorithm == "HIST_GRADIENT_BOOSTING"
        and active.artifact_sha256
    ):
        estimator = _load_artifact(active.artifact_path or "", active.artifact_sha256)
        method = "ML"
        model_id = active.id
    elif active is not None:
        model_id = active.id
    closed = set(
        db.scalars(
            select(CanteenClosure.service_date).where(CanteenClosure.canteen_id == canteen_id)
        )
    )
    targets = next_open_days(cutoff + timedelta(days=1), closed, horizon_days)
    item_ids = sorted({row.item_id for row in rows})
    names = {
        str(item.id): item.name
        for item in db.scalars(select(MenuItem).where(MenuItem.canteen_id == canteen_id))
    }
    values = []
    known_spread = None
    known_n = 0
    if active is not None:
        holdout = db.scalar(
            select(ModelEvaluation).where(
                ModelEvaluation.model_id == active.id, ModelEvaluation.role == "HOLDOUT"
            )
        )
        if holdout is not None and holdout.rmse_millis is not None:
            known_spread = holdout.rmse_millis / 1000
            known_n = holdout.n_points
    any_number = False
    for item_id in item_ids:
        preds = []
        for target in targets:
            quantity = _one(estimator, rows, item_id, target)
            preds.append(quantity)
        numeric = [qty for qty in preds if qty is not None]
        lowers, uppers, kind = (
            residual_band(numeric, [], known_spread=known_spread, known_n=known_n)
            if numeric
            else ([], [], "NONE")
        )
        cursor = 0
        for target, quantity in zip(targets, preds, strict=True):
            quality = "OK" if quantity is not None else "INSUFFICIENT"
            if quantity is None:
                lower = upper = None
                used_kind = "NONE"
            else:
                lower, upper = lowers[cursor], uppers[cursor]
                used_kind = kind
                cursor += 1
                any_number = True
            values.append((item_id, target, quantity, lower, upper, used_kind, quality))
    status = "COMPLETE" if any_number else "INSUFFICIENT_DATA"
    limitation = (
        "Numbers are estimates from history before the cutoff. They are not observed demand."
        if any_number
        else f"Fewer than {get_settings().forecast_min_baseline_days} open days for every item."
    )
    if source == "DEMO":
        limitation = "DEMO history only. " + limitation
    run = DemandForecastRun(
        canteen_id=canteen_id,
        model_id=model_id,
        method=method,
        source=source,
        horizon_days=horizon_days,
        data_cutoff=cutoff,
        status=status,
        limitations=limitation,
        idempotency_key=idempotency_key,
        generated_by=manager.id,
    )
    db.add(run)
    db.flush()
    for item_id, target, quantity, lower, upper, kind, quality in values:
        db.add(
            DemandForecastValue(
                run_id=run.id,
                canteen_id=canteen_id,
                menu_item_id=UUID(item_id),
                service_date=target,
                predicted_qty=quantity,
                lower_qty=lower,
                upper_qty=upper,
                range_kind=kind,
                data_quality=quality,
                limitations="" if quantity is not None else "Not enough history for this item.",
            )
        )
    db.commit()
    payload = _run_payload(db, run)
    payload["item_names"] = names
    return payload, False


def _actual(rows: list[Observation], item_id: str, day: date) -> int | None:
    for row in rows:
        if row.item_id == item_id and row.day == day and not row.closed and not row.censored:
            return row.qty
    return None


def _one(estimator, rows, item_id: str, target: date) -> int | None:
    if estimator is not None:
        return _predict_ml(estimator, rows, item_id, target)
    return _predict_baseline(rows, item_id, target)


def _run_payload(db: Session, run: DemandForecastRun) -> dict:
    values = db.scalars(
        select(DemandForecastValue)
        .where(DemandForecastValue.run_id == run.id)
        .order_by(DemandForecastValue.service_date)
    )
    return {
        "id": str(run.id),
        "method": run.method,
        "source": run.source,
        "status": run.status,
        "horizon_days": run.horizon_days,
        "data_cutoff": run.data_cutoff.isoformat(),
        "limitations": run.limitations,
        "generated_at": run.generated_at.isoformat(),
        "model_id": str(run.model_id) if run.model_id else None,
        "values": [
            {
                "menu_item_id": str(row.menu_item_id),
                "service_date": row.service_date.isoformat(),
                "predicted_qty": row.predicted_qty,
                "lower_qty": row.lower_qty,
                "upper_qty": row.upper_qty,
                "range_kind": row.range_kind,
                "data_quality": row.data_quality,
                "limitations": row.limitations,
            }
            for row in values
        ],
    }


def list_runs(db: Session, *, manager: User, limit: int) -> list[dict]:
    canteen_id = manager_canteen_id(db, manager)
    runs = db.scalars(
        select(DemandForecastRun)
        .where(DemandForecastRun.canteen_id == canteen_id)
        .order_by(DemandForecastRun.generated_at.desc())
        .limit(limit)
    )
    return [
        {
            "id": str(run.id),
            "method": run.method,
            "source": run.source,
            "status": run.status,
            "horizon_days": run.horizon_days,
            "data_cutoff": run.data_cutoff.isoformat(),
            "generated_at": run.generated_at.isoformat(),
            "limitations": run.limitations,
        }
        for run in runs
    ]


def get_run(db: Session, *, manager: User, run_id: UUID) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    run = db.get(DemandForecastRun, run_id)
    if run is None or run.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Forecast not found.", status_code=404)
    return _run_payload(db, run)


def latest_complete_run(db: Session, canteen_id: UUID) -> DemandForecastRun | None:
    return db.scalar(
        select(DemandForecastRun)
        .where(
            DemandForecastRun.canteen_id == canteen_id,
            DemandForecastRun.status == "COMPLETE",
        )
        .order_by(DemandForecastRun.generated_at.desc())
        .limit(1)
    )
