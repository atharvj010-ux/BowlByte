"""Request bodies for production, waste, forecasts, and plans."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

KEY_PATTERN = r"^[A-Za-z0-9_-]{8,80}$"


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProductionCreate(_In):
    menu_item_id: UUID
    service_date: date
    service_period: Literal["BREAKFAST", "LUNCH", "SNACKS", "DINNER", "ALL_DAY"] = "ALL_DAY"
    produced_qty: int = Field(ge=1, le=5000)
    prepared_at: datetime
    notes: str = Field(default="", max_length=400)
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class ProductionAdjust(_In):
    kind: Literal["SERVE_COUNTER", "DISCARD", "CORRECT"]
    quantity: int = Field(ge=0, le=5000)
    reason: str = Field(min_length=3, max_length=300)
    waste_reason: (
        Literal["UNSOLD", "PREPARATION_ERROR", "QUALITY_REJECTION", "SPOILAGE", "OTHER"] | None
    ) = None
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class WasteCreate(_In):
    menu_item_id: UUID
    batch_id: UUID | None = None
    service_date: date
    service_period: Literal["BREAKFAST", "LUNCH", "SNACKS", "DINNER", "ALL_DAY"] = "ALL_DAY"
    quantity: int = Field(ge=1, le=5000)
    reason: Literal["UNSOLD", "PREPARATION_ERROR", "QUALITY_REJECTION", "SPOILAGE", "OTHER"]
    notes: str = Field(default="", max_length=400)
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class ClosureWrite(_In):
    service_date: date
    closed: bool
    note: str = Field(default="", max_length=200)


class DemoSeed(_In):
    days: int = Field(default=60, ge=30, le=120)
    seed: int = Field(default=7, ge=0, le=10_000)


class TrainRequest(_In):
    source: Literal["REAL", "DEMO"]
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class ForecastRequest(_In):
    source: Literal["REAL", "DEMO"]
    horizon_days: Literal[1, 7] = 7
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class PlanRequest(_In):
    service_date: date
    forecast_run_id: UUID | None = None
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class PlanOverride(_In):
    menu_item_id: UUID
    quantity: int = Field(ge=0, le=5000)
    reason: str = Field(min_length=3, max_length=300)


class PlanDecision(_In):
    reason: str = Field(min_length=3, max_length=300)


class SimulateRequest(_In):
    service_date: date
    forecast_run_id: UUID | None = None
    demand_factor: float = Field(default=1, ge=0.5, le=2)
    buffer_ratio: float | None = Field(default=None, ge=0, le=0.5)
    window_seconds: int | None = Field(default=None, ge=600, le=8 * 3600)
    inactive_station_ids: list[UUID] = Field(default_factory=list)
    unavailable_item_ids: list[UUID] = Field(default_factory=list)
