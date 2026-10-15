"""Historical demand for analytics and forecasting.

Real rows come from orders, batches, waste, stock, and closures. Demo rows come
only from demo_demand_days. The two are never added together. No student id is
selected. Order dates are the service_date stored with the order (UTC at placement).
"""

import csv
import io
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.foodintel.core import Observation
from app.models.identity import User
from app.models.intelligence import (
    CanteenClosure,
    DemoDemandDay,
    FoodProductionBatch,
    FoodWasteRecord,
)
from app.models.ordering import DailyStock, MenuItem, Order, OrderItem, OrderPayment
from app.services.ordering import manager_canteen_id

PREPARED = ("PREPARING", "READY", "PICKED_UP")


def _created_day(moment: datetime) -> date:
    return moment.astimezone(ZoneInfo(get_settings().canteen_timezone)).date()


def real_history(db: Session, canteen_id: UUID, date_from: date, date_to: date) -> list[dict]:
    ordered = db.execute(
        select(
            Order.service_date,
            OrderItem.menu_item_id,
            func.sum(OrderItem.quantity),
            func.sum(OrderItem.quantity).filter(Order.status == "CANCELLED"),
            func.sum(OrderItem.quantity).filter(Order.status == "REJECTED"),
            func.sum(OrderItem.quantity).filter(Order.status == "PICKED_UP"),
            func.sum(OrderItem.quantity).filter(Order.status.in_(PREPARED)),
            func.sum(OrderItem.line_total_paise).filter(OrderPayment.status == "PAID"),
            func.count(func.distinct(Order.id)),
        )
        .join(OrderItem, OrderItem.order_id == Order.id)
        .outerjoin(OrderPayment, OrderPayment.order_id == Order.id)
        .where(
            Order.canteen_id == canteen_id,
            Order.service_date >= date_from,
            Order.service_date <= date_to,
        )
        .group_by(Order.service_date, OrderItem.menu_item_id)
    ).all()
    produced_map: dict[tuple, int] = {}
    for day, item_id, qty in db.execute(
        select(
            FoodProductionBatch.service_date,
            FoodProductionBatch.menu_item_id,
            func.sum(FoodProductionBatch.produced_qty),
        )
        .where(
            FoodProductionBatch.canteen_id == canteen_id,
            FoodProductionBatch.source == "REAL",
            FoodProductionBatch.service_date >= date_from,
            FoodProductionBatch.service_date <= date_to,
        )
        .group_by(FoodProductionBatch.service_date, FoodProductionBatch.menu_item_id)
    ).all():
        produced_map[(day, item_id)] = int(qty or 0)
    waste_map: dict[tuple, int] = {}
    for day, item_id, qty in db.execute(
        select(
            FoodWasteRecord.service_date,
            FoodWasteRecord.menu_item_id,
            func.sum(FoodWasteRecord.quantity),
        )
        .where(
            FoodWasteRecord.canteen_id == canteen_id,
            FoodWasteRecord.source == "REAL",
            FoodWasteRecord.service_date >= date_from,
            FoodWasteRecord.service_date <= date_to,
        )
        .group_by(FoodWasteRecord.service_date, FoodWasteRecord.menu_item_id)
    ).all():
        waste_map[(day, item_id)] = int(qty or 0)
    stock_rows = db.execute(
        select(
            DailyStock.service_date,
            DailyStock.menu_item_id,
            DailyStock.available_qty,
            DailyStock.consumed_qty,
        )
        .join(MenuItem, MenuItem.id == DailyStock.menu_item_id)
        .where(
            MenuItem.canteen_id == canteen_id,
            DailyStock.service_date >= date_from,
            DailyStock.service_date <= date_to,
        )
    ).all()
    stock_map = {
        (day, item_id): (int(available), int(consumed))
        for day, item_id, available, consumed in stock_rows
    }
    closed = set(
        db.scalars(
            select(CanteenClosure.service_date).where(
                CanteenClosure.canteen_id == canteen_id,
                CanteenClosure.service_date >= date_from,
                CanteenClosure.service_date <= date_to,
            )
        )
    )
    items = {
        row.id: row for row in db.scalars(select(MenuItem).where(MenuItem.canteen_id == canteen_id))
    }
    rows = []
    seen: set[tuple] = set()
    for day, item_id, ordered_qty, cancelled, rejected, picked, prepared, cash, orders in ordered:
        item = items.get(item_id)
        available, consumed = stock_map.get((day, item_id), (None, None))
        censored = available == 0 and (consumed or 0) > 0
        not_on_menu = item is not None and day < _created_day(item.created_at)
        quality = (
            "CLOSED"
            if day in closed
            else "NOT_ON_MENU"
            if not_on_menu
            else "CENSORED"
            if censored
            else "OBSERVED"
        )
        kept = int(ordered_qty or 0) - int(cancelled or 0) - int(rejected or 0)
        rows.append(
            {
                "service_date": day,
                "menu_item_id": item_id,
                "item_name": item.name if item else "Unknown item",
                "orders": int(orders or 0),
                "qty_ordered": int(ordered_qty or 0),
                "qty_cancelled": int(cancelled or 0),
                "qty_rejected": int(rejected or 0),
                "qty_picked_up": int(picked or 0),
                "qty_prepared": int(prepared or 0),
                "cash_confirmed_paise": int(cash or 0),
                "produced_qty": produced_map.get((day, item_id), 0),
                "discarded_qty": waste_map.get((day, item_id), 0),
                "closed": day in closed,
                "censored": censored and day not in closed,
                "quality": quality,
                "observed_demand_qty": 0 if day in closed or not_on_menu else max(kept, 0),
                "source": "REAL",
            }
        )
        seen.add((day, item_id))
    extras = set(produced_map) | set(waste_map)
    for day, item_id in extras:
        if (day, item_id) in seen:
            continue
        item = items.get(item_id)
        rows.append(
            {
                "service_date": day,
                "menu_item_id": item_id,
                "item_name": item.name if item else "Unknown item",
                "orders": 0,
                "qty_ordered": 0,
                "qty_cancelled": 0,
                "qty_rejected": 0,
                "qty_picked_up": 0,
                "qty_prepared": 0,
                "cash_confirmed_paise": 0,
                "produced_qty": produced_map.get((day, item_id), 0),
                "discarded_qty": waste_map.get((day, item_id), 0),
                "closed": day in closed,
                "censored": False,
                "quality": "CLOSED" if day in closed else "OBSERVED",
                "observed_demand_qty": 0,
                "source": "REAL",
            }
        )
    return rows


def demo_history(db: Session, canteen_id: UUID, date_from: date, date_to: date) -> list[dict]:
    rows = db.execute(
        select(DemoDemandDay, MenuItem.name)
        .join(MenuItem, MenuItem.id == DemoDemandDay.menu_item_id)
        .where(
            DemoDemandDay.canteen_id == canteen_id,
            DemoDemandDay.service_date >= date_from,
            DemoDemandDay.service_date <= date_to,
        )
        .order_by(DemoDemandDay.service_date, MenuItem.name)
    ).all()
    return [
        {
            "service_date": row.service_date,
            "menu_item_id": row.menu_item_id,
            "item_name": name,
            "orders": None,
            "qty_ordered": row.observed_qty,
            "qty_cancelled": 0,
            "qty_rejected": 0,
            "qty_picked_up": None,
            "qty_prepared": None,
            "cash_confirmed_paise": None,
            "produced_qty": row.produced_qty,
            "discarded_qty": row.discarded_qty,
            "closed": row.closed,
            "censored": row.censored,
            "quality": "CLOSED" if row.closed else "CENSORED" if row.censored else "DEMO",
            "observed_demand_qty": 0 if row.closed else row.observed_qty,
            "source": "DEMO",
        }
        for row, name in rows
    ]


def history(
    db: Session, *, manager: User, date_from: date, date_to: date, source: str
) -> list[dict]:
    canteen_id = manager_canteen_id(db, manager)
    rows = (
        real_history(db, canteen_id, date_from, date_to)
        if source == "REAL"
        else demo_history(
            db,
            canteen_id,
            date_from,
            date_to,
        )
    )
    return rows


def to_observations(rows: list[dict]) -> list[Observation]:
    return [
        Observation(
            item_id=str(row["menu_item_id"]),
            day=row["service_date"],
            qty=int(row["observed_demand_qty"]),
            censored=bool(row["censored"]),
            closed=bool(row["closed"]),
        )
        for row in rows
        if row["quality"] != "NOT_ON_MENU"
    ]


def history_csv(rows: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "source",
            "service_date",
            "menu_item_id",
            "item_name",
            "quality",
            "observed_demand_qty",
            "qty_ordered",
            "qty_cancelled",
            "qty_rejected",
            "qty_picked_up",
            "qty_prepared",
            "produced_qty",
            "discarded_qty",
            "cash_confirmed_paise",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row["source"],
                row["service_date"].isoformat(),
                row["menu_item_id"],
                row["item_name"],
                row["quality"],
                row["observed_demand_qty"],
                row["qty_ordered"],
                row["qty_cancelled"],
                row["qty_rejected"],
                "" if row["qty_picked_up"] is None else row["qty_picked_up"],
                "" if row["qty_prepared"] is None else row["qty_prepared"],
                row["produced_qty"],
                row["discarded_qty"],
                "" if row["cash_confirmed_paise"] is None else row["cash_confirmed_paise"],
            ]
        )
    return buffer.getvalue()
