"""Production batches, waste, demo demand, forecasts, and preparation plans."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_food_intelligence"
down_revision: str | None = "0005_cash_pickup_notifications"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())


def _id() -> sa.Column:
    return sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _canteen() -> sa.Column:
    return sa.Column("canteen_id", UUID, sa.ForeignKey("canteens.id"), nullable=False)


def _item() -> sa.Column:
    return sa.Column("menu_item_id", UUID, sa.ForeignKey("menu_items.id"), nullable=False)


def _user(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, UUID, sa.ForeignKey("users.id"), nullable=nullable)


def upgrade() -> None:
    op.execute("CREATE SEQUENCE production_batch_no_seq START 1")
    op.create_table(
        "food_production_batches",
        _id(),
        _canteen(),
        _item(),
        sa.Column("batch_code", sa.String(16), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("service_period", sa.String(16), nullable=False, server_default="ALL_DAY"),
        sa.Column("produced_qty", sa.Integer(), nullable=False),
        sa.Column("served_counter_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("remaining_qty", sa.Integer(), nullable=False),
        sa.Column("discarded_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prepared_at", TS, nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(8), nullable=False, server_default="REAL"),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        _user("created_by"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("canteen_id", "batch_code", name="uq_production_batches_code"),
        sa.UniqueConstraint("canteen_id", "idempotency_key", name="uq_production_batches_key"),
        sa.CheckConstraint(
            "service_period in ('BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER', 'ALL_DAY')",
            name="ck_production_batches_period",
        ),
        sa.CheckConstraint("produced_qty >= 0", name="ck_production_batches_produced"),
        sa.CheckConstraint("served_counter_qty >= 0", name="ck_production_batches_served"),
        sa.CheckConstraint("remaining_qty >= 0", name="ck_production_batches_remaining"),
        sa.CheckConstraint("discarded_qty >= 0", name="ck_production_batches_discarded"),
        sa.CheckConstraint(
            "produced_qty = served_counter_qty + remaining_qty + discarded_qty",
            name="ck_production_batches_equation",
        ),
        sa.CheckConstraint("source in ('REAL', 'DEMO')", name="ck_production_batches_source"),
    )
    op.create_index(
        "ix_production_batches_item_date",
        "food_production_batches",
        ["canteen_id", "menu_item_id", "service_date"],
    )
    op.create_table(
        "production_quantity_events",
        _id(),
        sa.Column("batch_id", UUID, sa.ForeignKey("food_production_batches.id"), nullable=False),
        _canteen(),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("produced_after", sa.Integer(), nullable=False),
        sa.Column("served_counter_after", sa.Integer(), nullable=False),
        sa.Column("remaining_after", sa.Integer(), nullable=False),
        sa.Column("discarded_after", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        _user("actor_user_id"),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("batch_id", "idempotency_key", name="uq_production_events_key"),
        sa.CheckConstraint(
            "kind in ('OPEN', 'SERVE_COUNTER', 'DISCARD', 'CORRECT')",
            name="ck_production_events_kind",
        ),
    )
    op.create_index(
        "ix_production_events_batch", "production_quantity_events", ["batch_id", "created_at"]
    )
    op.create_table(
        "food_waste_records",
        _id(),
        _canteen(),
        _item(),
        sa.Column("batch_id", UUID, sa.ForeignKey("food_production_batches.id")),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("service_period", sa.String(16), nullable=False, server_default="ALL_DAY"),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(8), nullable=False, server_default="REAL"),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        _user("recorded_by"),
        sa.Column("recorded_at", TS, nullable=False),
        sa.UniqueConstraint("canteen_id", "idempotency_key", name="uq_waste_records_key"),
        sa.CheckConstraint("quantity > 0", name="ck_waste_records_quantity"),
        sa.CheckConstraint(
            "reason in ('UNSOLD', 'PREPARATION_ERROR', 'QUALITY_REJECTION', 'SPOILAGE', 'OTHER')",
            name="ck_waste_records_reason",
        ),
        sa.CheckConstraint("source in ('REAL', 'DEMO')", name="ck_waste_records_source"),
    )
    op.create_index(
        "ix_waste_records_item_date",
        "food_waste_records",
        ["canteen_id", "menu_item_id", "service_date"],
    )
    op.create_table(
        "canteen_closures",
        _id(),
        _canteen(),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        _user("created_by"),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("canteen_id", "service_date", name="uq_canteen_closures_date"),
    )
    op.create_table(
        "demo_demand_days",
        _id(),
        _canteen(),
        _item(),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("observed_qty", sa.Integer(), nullable=False),
        sa.Column("produced_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discarded_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("censored", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("closed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("canteen_id", "menu_item_id", "service_date", name="uq_demo_demand_day"),
        sa.CheckConstraint("observed_qty >= 0", name="ck_demo_demand_observed"),
        sa.CheckConstraint("produced_qty >= 0", name="ck_demo_demand_produced"),
        sa.CheckConstraint("discarded_qty >= 0", name="ck_demo_demand_discarded"),
    )
    op.create_index("ix_demo_demand_canteen_date", "demo_demand_days", ["canteen_id", "service_date"])
    op.create_table(
        "forecasting_models",
        _id(),
        _canteen(),
        sa.Column("algorithm", sa.String(32), nullable=False),
        sa.Column("version_label", sa.String(40), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="CANDIDATE"),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("training_cutoff", sa.Date(), nullable=False),
        sa.Column("dataset_provenance", sa.Text(), nullable=False),
        sa.Column("feature_spec", JSONB, nullable=False),
        sa.Column("train_rows", sa.Integer(), nullable=False),
        sa.Column("valid_days", sa.Integer(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("metrics", JSONB, nullable=False),
        sa.Column("library_versions", JSONB, nullable=False),
        sa.Column("artifact_path", sa.Text()),
        sa.Column("artifact_sha256", sa.String(64)),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("selection_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("recommended", sa.Boolean(), nullable=False, server_default=sa.false()),
        _user("created_by", nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("activated_at", TS),
        sa.CheckConstraint(
            "algorithm in ('SEASONAL_NAIVE', 'HIST_GRADIENT_BOOSTING')",
            name="ck_forecasting_models_algorithm",
        ),
        sa.CheckConstraint("source in ('REAL', 'DEMO')", name="ck_forecasting_models_source"),
        sa.CheckConstraint(
            "status in ('CANDIDATE', 'ACTIVE', 'REJECTED', 'FAILED')",
            name="ck_forecasting_models_status",
        ),
    )
    op.create_index(
        "ix_forecasting_models_canteen",
        "forecasting_models",
        ["canteen_id", "source", "status"],
    )
    op.create_table(
        "forecast_jobs",
        _id(),
        _canteen(),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        _user("requested_by"),
        sa.Column("model_id", UUID),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", TS),
        sa.Column("finished_at", TS),
        sa.UniqueConstraint("canteen_id", "idempotency_key", name="uq_forecast_jobs_key"),
        sa.CheckConstraint("source in ('REAL', 'DEMO')", name="ck_forecast_jobs_source"),
        sa.CheckConstraint(
            "status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')",
            name="ck_forecast_jobs_status",
        ),
    )
    op.create_index("ix_forecast_jobs_canteen", "forecast_jobs", ["canteen_id", "created_at"])
    op.create_table(
        "model_evaluations",
        _id(),
        sa.Column("model_id", UUID, sa.ForeignKey("forecasting_models.id"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("mae", sa.Integer(), nullable=False),
        sa.Column("wape_millis", sa.Integer()),
        sa.Column("bias_millis", sa.Integer(), nullable=False),
        sa.Column("rmse_millis", sa.Integer(), nullable=False),
        sa.Column("n_points", sa.Integer(), nullable=False),
        sa.Column("n_days", sa.Integer(), nullable=False),
        sa.Column("n_items", sa.Integer(), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role in ('VALIDATION', 'HOLDOUT')", name="ck_model_evaluations_role"),
    )
    op.create_index("ix_model_evaluations_model", "model_evaluations", ["model_id"])
    op.create_table(
        "demand_forecast_runs",
        _id(),
        _canteen(),
        sa.Column("model_id", UUID, sa.ForeignKey("forecasting_models.id")),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("data_cutoff", sa.Date(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("limitations", sa.Text(), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        _user("generated_by"),
        sa.Column("generated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("canteen_id", "idempotency_key", name="uq_forecast_runs_key"),
        sa.CheckConstraint("method in ('BASELINE', 'ML')", name="ck_forecast_runs_method"),
        sa.CheckConstraint("source in ('REAL', 'DEMO')", name="ck_forecast_runs_source"),
        sa.CheckConstraint(
            "status in ('COMPLETE', 'INSUFFICIENT_DATA')", name="ck_forecast_runs_status"
        ),
        sa.CheckConstraint("horizon_days in (1, 7)", name="ck_forecast_runs_horizon"),
    )
    op.create_index(
        "ix_forecast_runs_canteen", "demand_forecast_runs", ["canteen_id", "generated_at"]
    )
    op.create_table(
        "demand_forecast_values",
        _id(),
        sa.Column("run_id", UUID, sa.ForeignKey("demand_forecast_runs.id"), nullable=False),
        _canteen(),
        _item(),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("service_period", sa.String(16), nullable=False, server_default="ALL_DAY"),
        sa.Column("predicted_qty", sa.Integer()),
        sa.Column("lower_qty", sa.Integer()),
        sa.Column("upper_qty", sa.Integer()),
        sa.Column("range_kind", sa.String(16), nullable=False, server_default="NONE"),
        sa.Column("data_quality", sa.String(24), nullable=False),
        sa.Column("limitations", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint(
            "run_id", "menu_item_id", "service_date", name="uq_forecast_values_point"
        ),
        sa.CheckConstraint(
            "predicted_qty IS NULL OR predicted_qty >= 0", name="ck_forecast_values_qty"
        ),
        sa.CheckConstraint(
            "range_kind in ('RESIDUAL', 'UNCALIBRATED', 'NONE')", name="ck_forecast_values_range"
        ),
    )
    op.create_index("ix_forecast_values_run", "demand_forecast_values", ["run_id"])
    op.create_table(
        "preparation_plans",
        _id(),
        _canteen(),
        sa.Column("forecast_run_id", UUID, sa.ForeignKey("demand_forecast_runs.id")),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("solver", sa.String(16), nullable=False),
        sa.Column("objective_note", sa.Text(), nullable=False),
        sa.Column("input_snapshot", JSONB, nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        _user("created_by"),
        _user("decided_by", nullable=True),
        sa.Column("decision_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("decided_at", TS),
        sa.Column("superseded_by", UUID),
        sa.UniqueConstraint("canteen_id", "idempotency_key", name="uq_preparation_plans_key"),
        sa.CheckConstraint(
            "status in ('DRAFT', 'REVIEWED', 'APPROVED', 'REJECTED', 'SUPERSEDED')",
            name="ck_preparation_plans_status",
        ),
    )
    op.create_index(
        "ix_preparation_plans_canteen_date", "preparation_plans", ["canteen_id", "service_date"]
    )
    op.create_table(
        "preparation_plan_items",
        _id(),
        sa.Column("plan_id", UUID, sa.ForeignKey("preparation_plans.id"), nullable=False),
        _item(),
        sa.Column("forecast_qty", sa.Integer()),
        sa.Column("confirmed_unfulfilled_qty", sa.Integer(), nullable=False),
        sa.Column("usable_prepared_qty", sa.Integer(), nullable=False),
        sa.Column("scheduled_qty", sa.Integer(), nullable=False),
        sa.Column("buffer_qty", sa.Integer(), nullable=False),
        sa.Column("target_qty", sa.Integer(), nullable=False),
        sa.Column("recommended_additional_qty", sa.Integer(), nullable=False),
        sa.Column("feasible_qty", sa.Integer(), nullable=False),
        sa.Column("unmet_qty", sa.Integer(), nullable=False),
        sa.Column("station_id", UUID, sa.ForeignKey("kitchen_stations.id")),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("capacity_limited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("override_qty", sa.Integer()),
        sa.Column("override_reason", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("plan_id", "menu_item_id", name="uq_plan_items_item"),
        sa.CheckConstraint("recommended_additional_qty >= 0", name="ck_plan_items_recommended"),
        sa.CheckConstraint("feasible_qty >= 0", name="ck_plan_items_feasible"),
    )
    op.create_table(
        "preparation_plan_events",
        _id(),
        sa.Column("plan_id", UUID, sa.ForeignKey("preparation_plans.id"), nullable=False),
        sa.Column("event_type", sa.String(16), nullable=False),
        _user("actor_user_id"),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "event_type in ('CREATED', 'ADJUSTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')",
            name="ck_plan_events_type",
        ),
    )
    op.create_index(
        "ix_plan_events_plan", "preparation_plan_events", ["plan_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("preparation_plan_events")
    op.drop_table("preparation_plan_items")
    op.drop_table("preparation_plans")
    op.drop_table("demand_forecast_values")
    op.drop_table("demand_forecast_runs")
    op.drop_table("model_evaluations")
    op.drop_table("forecast_jobs")
    op.drop_table("forecasting_models")
    op.drop_table("demo_demand_days")
    op.drop_table("canteen_closures")
    op.drop_table("food_waste_records")
    op.drop_table("production_quantity_events")
    op.drop_table("food_production_batches")
    op.execute("DROP SEQUENCE production_batch_no_seq")
