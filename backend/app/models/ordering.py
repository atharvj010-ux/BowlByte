"""Menu, stock, and cash-on-pickup order tables.

P003 writes PLACED and CANCELLED only. Later fulfillment statuses are stored
as checked values so P004 can use the same rows without a rewrite.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.identity import _uuid

ORDER_STATUSES = (
    "PLACED",
    "ACCEPTED",
    "QUEUED",
    "PREPARING",
    "READY",
    "PICKED_UP",
    "REJECTED",
    "CANCELLED",
    "UNCLAIMED",
)
P003_ORDER_STATUSES = ("PLACED", "CANCELLED")
PAYMENT_STATUSES = ("PENDING", "PAID", "VOIDED")
CASH = "CASH"


class MenuCategory(Base):
    __tablename__ = "menu_categories"
    __table_args__ = (
        UniqueConstraint("canteen_id", "name", name="uq_menu_categories_name"),
        Index("ix_menu_categories_canteen_id", "canteen_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class KitchenStation(Base):
    __tablename__ = "kitchen_stations"
    __table_args__ = (
        UniqueConstraint("canteen_id", "name", name="uq_kitchen_stations_name"),
        CheckConstraint("parallel_capacity > 0", name="ck_kitchen_stations_capacity"),
        Index("ix_kitchen_stations_canteen_id", "canteen_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    parallel_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MenuItem(Base):
    __tablename__ = "menu_items"
    __table_args__ = (
        CheckConstraint("price_paise >= 0", name="ck_menu_items_price"),
        CheckConstraint(
            "prep_seconds >= 30 AND prep_seconds <= 7200",
            name="ck_menu_items_prep",
        ),
        CheckConstraint(
            "(image_bytes IS NULL) = (image_content_type IS NULL)",
            name="ck_menu_items_image_pair",
        ),
        Index(
            "uq_menu_items_seed_key",
            "canteen_id",
            "seed_key",
            unique=True,
            postgresql_where=text("seed_key IS NOT NULL"),
        ),
        Index("ix_menu_items_canteen_active", "canteen_id", "is_active"),
        Index("ix_menu_items_category_id", "category_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_categories.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    image_bytes: Mapped[bytes | None] = mapped_column(LargeBinary)
    image_content_type: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    prep_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    seed_key: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MenuItemStationAssignment(Base):
    __tablename__ = "menu_item_station_assignments"
    __table_args__ = (
        UniqueConstraint("menu_item_id", name="uq_menu_item_station"),
        Index("ix_menu_item_station_station_id", "station_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_items.id"),
        nullable=False,
    )
    station_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kitchen_stations.id"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DailyStock(Base):
    __tablename__ = "daily_stock"
    __table_args__ = (
        UniqueConstraint("menu_item_id", "service_date", name="uq_daily_stock_item_date"),
        CheckConstraint("available_qty >= 0", name="ck_daily_stock_available"),
        CheckConstraint("reserved_qty >= 0", name="ck_daily_stock_reserved"),
        CheckConstraint("consumed_qty >= 0", name="ck_daily_stock_consumed"),
        Index("ix_daily_stock_service_date", "service_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_items.id"), nullable=False
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    available_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    consumed_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class InventoryAdjustment(Base):
    __tablename__ = "inventory_adjustments"
    __table_args__ = (
        Index("ix_inventory_adjustments_stock_id", "daily_stock_id"),
        Index("ix_inventory_adjustments_order_id", "order_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    daily_stock_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("daily_stock.id"), nullable=False
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_items.id"), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    delta_available: Mapped[int] = mapped_column(Integer, nullable=False)
    delta_reserved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("ticket_number", name="uq_orders_ticket_number"),
        CheckConstraint(
            "status in ('PLACED', 'ACCEPTED', 'QUEUED', 'PREPARING', 'READY', "
            "'PICKED_UP', 'REJECTED', 'CANCELLED', 'UNCLAIMED')",
            name="ck_orders_status",
        ),
        CheckConstraint("payment_method = 'CASH'", name="ck_orders_payment_method"),
        CheckConstraint("total_paise >= 0", name="ck_orders_total"),
        CheckConstraint("version >= 1", name="ck_orders_version"),
        CheckConstraint("note IS NULL OR char_length(note) <= 240", name="ck_orders_note"),
        Index("ix_orders_student_created", "student_user_id", "created_at"),
        Index("ix_orders_canteen_status_created", "canteen_id", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    ticket_number: Mapped[str] = mapped_column(String(16), nullable=False)
    student_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    total_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(16), nullable=False, default=CASH)
    note: Mapped[str | None] = mapped_column(Text)
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    eta_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    eta_earliest_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    eta_latest_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    eta_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    eta_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    eta_overdue: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    eta_blocked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_items_quantity"),
        CheckConstraint("unit_price_paise >= 0", name="ck_order_items_price"),
        CheckConstraint(
            "line_total_paise = unit_price_paise * quantity",
            name="ck_order_items_line_total",
        ),
        Index("ix_order_items_order_id", "order_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id"),
        nullable=False,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_items.id"), nullable=False
    )
    item_name: Mapped[str] = mapped_column(Text, nullable=False)
    unit_price_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    station_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("kitchen_stations.id")
    )
    station_name: Mapped[str | None] = mapped_column(Text)
    prep_seconds: Mapped[int] = mapped_column(Integer, nullable=False)


class OrderEvent(Base):
    __tablename__ = "order_events"
    __table_args__ = (Index("ix_order_events_order_id", "order_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class OrderPayment(Base):
    __tablename__ = "order_payments"
    __table_args__ = (
        UniqueConstraint("order_id", name="uq_order_payments_order"),
        CheckConstraint("method = 'CASH'", name="ck_order_payments_method"),
        CheckConstraint(
            "status in ('PENDING', 'PAID', 'VOIDED')",
            name="ck_order_payments_status",
        ),
        CheckConstraint("amount_paise >= 0", name="ck_order_payments_amount"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False
    )
    method: Mapped[str] = mapped_column(String(16), nullable=False, default=CASH)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PreparationTask(Base):
    __tablename__ = "preparation_tasks"
    __table_args__ = (
        UniqueConstraint("order_item_id", "unit_index", name="uq_preparation_tasks_unit"),
        CheckConstraint("unit_index >= 1", name="ck_preparation_tasks_unit"),
        CheckConstraint(
            "expected_duration_seconds >= 30 AND expected_duration_seconds <= 7200",
            name="ck_preparation_tasks_duration",
        ),
        CheckConstraint("extra_delay_seconds >= 0", name="ck_preparation_tasks_delay"),
        CheckConstraint(
            "status in ('QUEUED', 'IN_PROGRESS', 'DONE', 'CANCELLED')",
            name="ck_preparation_tasks_status",
        ),
        Index("ix_preparation_tasks_order_id", "order_id"),
        Index("ix_preparation_tasks_station_status", "kitchen_station_id", "status"),
        Index("ix_preparation_tasks_canteen_status", "canteen_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False
    )
    order_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order_items.id"), nullable=False
    )
    canteen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("canteens.id"), nullable=False
    )
    kitchen_station_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("kitchen_stations.id"), nullable=False
    )
    station_name: Mapped[str] = mapped_column(Text, nullable=False)
    item_name: Mapped[str] = mapped_column(Text, nullable=False)
    unit_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    expected_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    extra_delay_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delay_reason: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    completed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class OrderIdempotencyRecord(Base):
    __tablename__ = "order_idempotency_records"
    __table_args__ = (
        UniqueConstraint(
            "student_user_id",
            "idempotency_key",
            name="uq_order_idempotency_student_key",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    student_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
