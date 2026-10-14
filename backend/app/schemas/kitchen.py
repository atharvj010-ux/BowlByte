from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.ordering import OrderItemResponse, PaymentResponse, _Strict


class RejectRequest(_Strict):
    reason: str = Field(min_length=1, max_length=200)


class DelayRequest(_Strict):
    extra_seconds: int = Field(ge=30, le=3600)
    reason: str = Field(min_length=1, max_length=200)


class ReadyRequest(_Strict):
    packed: bool


class TaskResponse(_Strict):
    id: UUID
    order_id: UUID
    order_item_id: UUID
    station_id: UUID
    station_name: str
    item_name: str
    unit_index: int
    status: str
    expected_duration_seconds: int
    extra_delay_seconds: int
    delay_reason: str | None
    started_at: datetime | None
    completed_at: datetime | None


class TrackedOrderResponse(_Strict):
    id: UUID
    ticket_number: str
    status: str
    version: int
    total_paise: int
    note: str | None
    created_at: datetime
    updated_at: datetime
    accepted_at: datetime | None
    ready_at: datetime | None
    eta_ready_at: datetime | None
    eta_earliest_at: datetime | None
    eta_latest_at: datetime | None
    eta_computed_at: datetime | None
    eta_version: int
    eta_overdue: bool
    eta_blocked: bool
    payment: PaymentResponse
    items: list[OrderItemResponse]
    tasks: list[TaskResponse]


class StationWorkloadResponse(_Strict):
    id: UUID
    name: str
    parallel_capacity: int
    is_active: bool
    waiting: int
    in_progress: int
    backlog_seconds: int
    longest_waiting_ticket: str | None


class KitchenQueueResponse(_Strict):
    orders: list[TrackedOrderResponse]
    stations: list[StationWorkloadResponse]


class OverviewNotes(_Strict):
    observed: str
    estimated: str
    cash_collected: str


class KitchenOverviewResponse(_Strict):
    placed: int
    waiting: int
    preparing: int
    ready: int
    active_orders: int
    average_observed_prep_seconds: int | None
    average_queue_wait_seconds: int | None
    delayed_orders: int
    stations: list[StationWorkloadResponse]
    notes: OverviewNotes
