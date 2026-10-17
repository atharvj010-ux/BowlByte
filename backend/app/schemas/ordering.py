from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ImageType = Literal["image/jpeg", "image/png", "image/webp"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoryCreateRequest(_Strict):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=100_000)


class CategoryUpdateRequest(_Strict):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=100_000)
    is_active: bool | None = None


class CategoryMoveRequest(_Strict):
    direction: Literal["up", "down"]


class CategoryResponse(_Strict):
    id: UUID
    name: str
    sort_order: int
    is_active: bool
    is_demo: bool


class StationCreateRequest(_Strict):
    name: str = Field(min_length=1, max_length=80)
    parallel_capacity: int = Field(ge=1, le=20)


class StationUpdateRequest(_Strict):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    parallel_capacity: int | None = Field(default=None, ge=1, le=20)
    is_active: bool | None = None


class StationResponse(_Strict):
    id: UUID
    name: str
    parallel_capacity: int
    is_active: bool
    is_demo: bool


class MenuItemWrite(_Strict):
    category_id: UUID
    station_id: UUID
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=400)
    price_paise: int = Field(ge=0, le=100_000_00)
    prep_seconds: int = Field(ge=30, le=7200)
    is_active: bool = True
    is_available: bool = True
    sort_order: int | None = Field(default=None, ge=0, le=100_000)
    is_featured: bool = False
    initial_available_qty: int | None = Field(default=None, ge=0, le=10_000)
    calories_kcal: int | None = Field(default=None, ge=0, le=5000)
    serving_size_description: str | None = Field(default=None, max_length=80)
    nutrition_source: Literal["VERIFIED", "ILLUSTRATIVE"] | None = None
    nutrition_reference: str | None = Field(default=None, max_length=160)


class MenuItemUpdateRequest(_Strict):
    category_id: UUID | None = None
    station_id: UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=400)
    price_paise: int | None = Field(default=None, ge=0, le=100_000_00)
    prep_seconds: int | None = Field(default=None, ge=30, le=7200)
    is_active: bool | None = None
    is_available: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100_000)
    is_featured: bool | None = None
    calories_kcal: int | None = Field(default=None, ge=0, le=5000)
    serving_size_description: str | None = Field(default=None, max_length=80)
    nutrition_source: Literal["VERIFIED", "ILLUSTRATIVE"] | None = None
    nutrition_reference: str | None = Field(default=None, max_length=160)


class ImageUploadRequest(_Strict):
    content_base64: str = Field(min_length=8, max_length=2_100_000)
    content_type: ImageType


class MenuItemResponse(_Strict):
    id: UUID
    category_id: UUID
    category_name: str
    station_id: UUID | None
    station_name: str | None
    name: str
    description: str
    price_paise: int
    prep_seconds: int
    is_active: bool
    is_available: bool
    is_demo: bool
    sort_order: int = 0
    is_featured: bool = False
    category_sort_order: int = 0
    calories_kcal: int | None = None
    serving_size_description: str | None = None
    nutrition_source: Literal["VERIFIED", "ILLUSTRATIVE"] | None = None
    nutrition_reference: str | None = None
    image_url: str | None
    available_qty: int
    reserved_qty: int | None = None


class PairingCreateRequest(_Strict):
    suggested_item_id: UUID
    priority: int = Field(default=0, ge=0, le=100)


class PairingResponse(_Strict):
    id: UUID
    suggested_item_id: UUID
    suggested_name: str
    priority: int
    is_active: bool


class PairingListResponse(_Strict):
    basis: Literal["MANAGER", "CATEGORY"]
    items: list[MenuItemResponse]


class MenuListResponse(_Strict):
    items: list[MenuItemResponse]
    total: int
    limit: int
    offset: int


class StockRowResponse(_Strict):
    menu_item_id: UUID
    name: str
    service_date: date
    available_qty: int
    reserved_qty: int
    consumed_qty: int
    is_active: bool
    is_available: bool
    low_stock: bool
    out_of_stock: bool


class StockListResponse(_Strict):
    rows: list[StockRowResponse]
    service_date: date


class StockUpdateRequest(_Strict):
    available_qty: int = Field(ge=0, le=10_000)
    reason: str = Field(min_length=1, max_length=80)


class OrderLineRequest(_Strict):
    menu_item_id: UUID
    quantity: int = Field(ge=1, le=20)


class OrderCreateRequest(_Strict):
    items: list[OrderLineRequest] = Field(min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=240)
    idempotency_key: str = Field(pattern=r"^[A-Za-z0-9_-]{16,80}$")


class OrderItemResponse(_Strict):
    menu_item_id: UUID
    item_name: str
    unit_price_paise: int
    quantity: int
    line_total_paise: int
    station_name: str | None
    prep_seconds: int


class PaymentResponse(_Strict):
    method: Literal["CASH"]
    status: Literal["PENDING", "PAID", "VOIDED"]
    amount_paise: int
    paid_at: datetime | None = None


class OrderResponse(_Strict):
    id: UUID
    ticket_number: str
    status: str
    total_paise: int
    note: str | None
    created_at: datetime
    updated_at: datetime
    ready_at: datetime | None = None
    picked_up_at: datetime | None = None
    payment: PaymentResponse
    items: list[OrderItemResponse]
    canteen_id: UUID
    student_name: str | None = None


class OrderListResponse(_Strict):
    orders: list[OrderResponse]
    total: int
    limit: int
    offset: int


class OrderTotalsResponse(_Strict):
    placed_paise: int
    cancelled_paise: int
    cash_collected_paise: None = None
    cash_collected_note: str


class ManagerOrderListResponse(OrderListResponse):
    totals: OrderTotalsResponse
