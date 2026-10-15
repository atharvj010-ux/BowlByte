"""Production, waste, forecasts, and preparation plans.

These rows never change an order, a payment, or P003 daily stock. A production
batch is food the kitchen actually made. Saleable stock is a separate ledger.
Demo demand rows are not orders and are not cash.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.identity import _uuid

PERIODS = ("BREAKFAST", "LUNCH", "SNACKS", "DINNER", "ALL_DAY")
WASTE_REASONS = ("UNSOLD", "PREPARATION_ERROR", "QUALITY_REJECTION", "SPOILAGE", "OTHER")
BATCH_EVENTS = ("OPEN", "SERVE_COUNTER", "DISCARD", "CORRECT")
PLAN_STATES = ("DRAFT", "REVIEWED", "APPROVED", "REJECTED", "SUPERSEDED")


def _ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class FoodProductionBatch(Base):
    __tablename__ = "food_production_batches"
    __table_args__ = (
        UniqueConstraint("canteen_id", "batch_code", name="uq_production_batches_code"),
        UniqueConstraint("canteen_id", "idempotency_key", name="uq_production_batches_key"),
        CheckConstraint(
            "service_period in ('BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER', 'ALL_DAY')",
            name="ck_production_batches_period",
        ),
        CheckConstraint("produced_qty >= 0", name="ck_production_batches_produced"),
        CheckConstraint("served_counter_qty >= 0", name="ck_production_batches_served"),
        CheckConstraint("remaining_qty >= 0", name="ck_production_batches_remaining"),
        CheckConstraint("discarded_qty >= 0", name="ck_production_batches_discarded"),
        CheckConstraint(
            "produced_qty = served_counter_qty + remaining_qty + discarded_qty",
            name="ck_production_batches_equation",
        ),
        CheckConstraint("source in ('REAL', 'DEMO')", name="ck_production_batches_source"),
        Index("ix_production_batches_item_date", "canteen_id", "menu_item_id", "service_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_items.id"),
        nullable=False,
    )
    batch_code: Mapped[str] = mapped_column(String(16), nullable=False)
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    service_period: Mapped[str] = mapped_column(String(16), nullable=False, default="ALL_DAY")
    produced_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    served_counter_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    remaining_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    discarded_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prepared_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="REAL")
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts()


class ProductionQuantityEvent(Base):
    __tablename__ = "production_quantity_events"
    __table_args__ = (
        UniqueConstraint("batch_id", "idempotency_key", name="uq_production_events_key"),
        CheckConstraint(
            "kind in ('OPEN', 'SERVE_COUNTER', 'DISCARD', 'CORRECT')",
            name="ck_production_events_kind",
        ),
        Index("ix_production_events_batch", "batch_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("food_production_batches.id"), nullable=False
    )
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    produced_after: Mapped[int] = mapped_column(Integer, nullable=False)
    served_counter_after: Mapped[int] = mapped_column(Integer, nullable=False)
    remaining_after: Mapped[int] = mapped_column(Integer, nullable=False)
    discarded_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = _ts()


class FoodWasteRecord(Base):
    __tablename__ = "food_waste_records"
    __table_args__ = (
        UniqueConstraint("canteen_id", "idempotency_key", name="uq_waste_records_key"),
        CheckConstraint("quantity > 0", name="ck_waste_records_quantity"),
        CheckConstraint(
            "reason in ('UNSOLD', 'PREPARATION_ERROR', 'QUALITY_REJECTION', 'SPOILAGE', 'OTHER')",
            name="ck_waste_records_reason",
        ),
        CheckConstraint("source in ('REAL', 'DEMO')", name="ck_waste_records_source"),
        Index("ix_waste_records_item_date", "canteen_id", "menu_item_id", "service_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_items.id"),
        nullable=False,
    )
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("food_production_batches.id"),
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    service_period: Mapped[str] = mapped_column(String(16), nullable=False, default="ALL_DAY")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="REAL")
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    recorded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CanteenClosure(Base):
    __tablename__ = "canteen_closures"
    __table_args__ = (
        UniqueConstraint("canteen_id", "service_date", name="uq_canteen_closures_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    created_at: Mapped[datetime] = _ts()


class DemoDemandDay(Base):
    """Seeded history for demos. Never an order, a payment, or a production batch."""

    __tablename__ = "demo_demand_days"
    __table_args__ = (
        UniqueConstraint("canteen_id", "menu_item_id", "service_date", name="uq_demo_demand_day"),
        CheckConstraint("observed_qty >= 0", name="ck_demo_demand_observed"),
        CheckConstraint("produced_qty >= 0", name="ck_demo_demand_produced"),
        CheckConstraint("discarded_qty >= 0", name="ck_demo_demand_discarded"),
        Index("ix_demo_demand_canteen_date", "canteen_id", "service_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_items.id"),
        nullable=False,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    observed_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    produced_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    discarded_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    censored: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = _ts()


class ForecastJob(Base):
    __tablename__ = "forecast_jobs"
    __table_args__ = (
        UniqueConstraint("canteen_id", "idempotency_key", name="uq_forecast_jobs_key"),
        CheckConstraint("source in ('REAL', 'DEMO')", name="ck_forecast_jobs_source"),
        CheckConstraint(
            "status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')",
            name="ck_forecast_jobs_status",
        ),
        Index("ix_forecast_jobs_canteen", "canteen_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    requested_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _ts()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ForecastingModel(Base):
    __tablename__ = "forecasting_models"
    __table_args__ = (
        CheckConstraint(
            "algorithm in ('SEASONAL_NAIVE', 'HIST_GRADIENT_BOOSTING')",
            name="ck_forecasting_models_algorithm",
        ),
        CheckConstraint("source in ('REAL', 'DEMO')", name="ck_forecasting_models_source"),
        CheckConstraint(
            "status in ('CANDIDATE', 'ACTIVE', 'REJECTED', 'FAILED')",
            name="ck_forecasting_models_status",
        ),
        Index("ix_forecasting_models_canteen", "canteen_id", "source", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    algorithm: Mapped[str] = mapped_column(String(32), nullable=False)
    version_label: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="CANDIDATE")
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    training_cutoff: Mapped[date] = mapped_column(Date, nullable=False)
    dataset_provenance: Mapped[str] = mapped_column(Text, nullable=False)
    feature_spec: Mapped[dict] = mapped_column(JSONB, nullable=False)
    train_rows: Mapped[int] = mapped_column(Integer, nullable=False)
    valid_days: Mapped[int] = mapped_column(Integer, nullable=False)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False)
    library_versions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    artifact_path: Mapped[str | None] = mapped_column(Text)
    artifact_sha256: Mapped[str | None] = mapped_column(String(64))
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    selection_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    recommended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = _ts()
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ModelEvaluation(Base):
    __tablename__ = "model_evaluations"
    __table_args__ = (
        CheckConstraint("role in ('VALIDATION', 'HOLDOUT')", name="ck_model_evaluations_role"),
        Index("ix_model_evaluations_model", "model_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("forecasting_models.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    horizon_days: Mapped[int] = mapped_column(Integer, nullable=False)
    mae: Mapped[int] = mapped_column(Integer, nullable=False)  # milli-portions, see service
    wape_millis: Mapped[int | None] = mapped_column(Integer)  # null when undefined
    bias_millis: Mapped[int] = mapped_column(Integer, nullable=False)
    rmse_millis: Mapped[int] = mapped_column(Integer, nullable=False)
    n_points: Mapped[int] = mapped_column(Integer, nullable=False)
    n_days: Mapped[int] = mapped_column(Integer, nullable=False)
    n_items: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = _ts()


class DemandForecastRun(Base):
    __tablename__ = "demand_forecast_runs"
    __table_args__ = (
        UniqueConstraint("canteen_id", "idempotency_key", name="uq_forecast_runs_key"),
        CheckConstraint("method in ('BASELINE', 'ML')", name="ck_forecast_runs_method"),
        CheckConstraint("source in ('REAL', 'DEMO')", name="ck_forecast_runs_source"),
        CheckConstraint(
            "status in ('COMPLETE', 'INSUFFICIENT_DATA')",
            name="ck_forecast_runs_status",
        ),
        CheckConstraint("horizon_days in (1, 7)", name="ck_forecast_runs_horizon"),
        Index("ix_forecast_runs_canteen", "canteen_id", "generated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("forecasting_models.id"),
    )
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    horizon_days: Mapped[int] = mapped_column(Integer, nullable=False)
    data_cutoff: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    limitations: Mapped[str] = mapped_column(Text, nullable=False, default="")
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    generated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    generated_at: Mapped[datetime] = _ts()


class DemandForecastValue(Base):
    __tablename__ = "demand_forecast_values"
    __table_args__ = (
        UniqueConstraint("run_id", "menu_item_id", "service_date", name="uq_forecast_values_point"),
        CheckConstraint(
            "predicted_qty IS NULL OR predicted_qty >= 0",
            name="ck_forecast_values_qty",
        ),
        CheckConstraint(
            "range_kind in ('RESIDUAL', 'UNCALIBRATED', 'NONE')",
            name="ck_forecast_values_range",
        ),
        Index("ix_forecast_values_run", "run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("demand_forecast_runs.id"), nullable=False
    )
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_items.id"),
        nullable=False,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    service_period: Mapped[str] = mapped_column(String(16), nullable=False, default="ALL_DAY")
    predicted_qty: Mapped[int | None] = mapped_column(Integer)
    lower_qty: Mapped[int | None] = mapped_column(Integer)
    upper_qty: Mapped[int | None] = mapped_column(Integer)
    range_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="NONE")
    data_quality: Mapped[str] = mapped_column(String(24), nullable=False)
    limitations: Mapped[str] = mapped_column(Text, nullable=False, default="")


class PreparationPlan(Base):
    __tablename__ = "preparation_plans"
    __table_args__ = (
        UniqueConstraint("canteen_id", "idempotency_key", name="uq_preparation_plans_key"),
        CheckConstraint(
            "status in ('DRAFT', 'REVIEWED', 'APPROVED', 'REJECTED', 'SUPERSEDED')",
            name="ck_preparation_plans_status",
        ),
        Index("ix_preparation_plans_canteen_date", "canteen_id", "service_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("canteens.id"),
        nullable=False,
    )
    forecast_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("demand_forecast_runs.id"),
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT")
    solver: Mapped[str] = mapped_column(String(16), nullable=False)
    objective_note: Mapped[str] = mapped_column(Text, nullable=False)
    input_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    decision_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = _ts()
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class PreparationPlanItem(Base):
    __tablename__ = "preparation_plan_items"
    __table_args__ = (
        UniqueConstraint("plan_id", "menu_item_id", name="uq_plan_items_item"),
        CheckConstraint("recommended_additional_qty >= 0", name="ck_plan_items_recommended"),
        CheckConstraint("feasible_qty >= 0", name="ck_plan_items_feasible"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("preparation_plans.id"), nullable=False
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_items.id"),
        nullable=False,
    )
    forecast_qty: Mapped[int | None] = mapped_column(Integer)
    confirmed_unfulfilled_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    usable_prepared_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    scheduled_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    buffer_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    target_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    recommended_additional_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    feasible_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    unmet_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    station_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kitchen_stations.id"),
    )
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    capacity_limited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    override_qty: Mapped[int | None] = mapped_column(Integer)
    override_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")


class PreparationPlanEvent(Base):
    __tablename__ = "preparation_plan_events"
    __table_args__ = (
        CheckConstraint(
            "event_type in ('CREATED', 'ADJUSTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')",
            name="ck_plan_events_type",
        ),
        Index("ix_plan_events_plan", "plan_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("preparation_plans.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = _ts()
