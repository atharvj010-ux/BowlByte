"""Production batches and waste.

A batch obeys produced = counter servings + still remaining + discarded.
Online pickups are not written into that equation. Corrections append an event.
Nothing here changes daily_stock, orders, or payments.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.identity import User
from app.models.intelligence import (
    PERIODS,
    WASTE_REASONS,
    CanteenClosure,
    FoodProductionBatch,
    FoodWasteRecord,
    ProductionQuantityEvent,
)
from app.models.ordering import MenuItem, Order, OrderItem
from app.services.identity import _audit as audit
from app.services.ordering import manager_canteen_id

Clock = Callable[[], datetime]
OPEN = ("PLACED", "ACCEPTED", "QUEUED", "PREPARING", "READY")


def utcnow() -> datetime:
    return datetime.now(UTC)


def local_today():
    return datetime.now(ZoneInfo(get_settings().canteen_timezone)).date()


def _item(db: Session, canteen_id: UUID, item_id: UUID) -> MenuItem:
    item = db.get(MenuItem, item_id)
    if item is None or item.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    return item


def _name(db: Session, item_id: UUID) -> str:
    item = db.get(MenuItem, item_id)
    return item.name if item else "Unknown item"


def _payload(batch: FoodProductionBatch, item_name: str) -> dict:
    return {
        "id": str(batch.id),
        "batch_code": batch.batch_code,
        "menu_item_id": str(batch.menu_item_id),
        "item_name": item_name,
        "service_date": batch.service_date.isoformat(),
        "service_period": batch.service_period,
        "produced_qty": batch.produced_qty,
        "served_counter_qty": batch.served_counter_qty,
        "remaining_qty": batch.remaining_qty,
        "discarded_qty": batch.discarded_qty,
        "prepared_at": batch.prepared_at.isoformat(),
        "notes": batch.notes,
        "source": batch.source,
        "version": batch.version,
        "equation": "produced = counter servings + remaining + discarded",
    }


def _event(
    db: Session,
    batch: FoodProductionBatch,
    *,
    kind: str,
    quantity: int,
    reason: str,
    actor_id: UUID,
    key: str,
) -> None:
    db.add(
        ProductionQuantityEvent(
            batch_id=batch.id,
            canteen_id=batch.canteen_id,
            kind=kind,
            quantity=quantity,
            produced_after=batch.produced_qty,
            served_counter_after=batch.served_counter_qty,
            remaining_after=batch.remaining_qty,
            discarded_after=batch.discarded_qty,
            reason=reason[:300],
            actor_user_id=actor_id,
            idempotency_key=key,
        )
    )


def create_batch(
    db: Session,
    *,
    manager: User,
    menu_item_id: UUID,
    service_date,
    service_period: str,
    produced_qty: int,
    prepared_at: datetime,
    notes: str,
    idempotency_key: str,
) -> tuple[dict, bool]:
    canteen_id = manager_canteen_id(db, manager)
    if service_period not in PERIODS:
        raise ApiError(code="VALIDATION_ERROR", message="Unknown service period.", status_code=422)
    if not 1 <= produced_qty <= 5000:
        raise ApiError(
            code="VALIDATION_ERROR", message="Record between 1 and 5000 portions.", status_code=422
        )
    item = _item(db, canteen_id, menu_item_id)
    existing = db.scalar(
        select(FoodProductionBatch).where(
            FoodProductionBatch.canteen_id == canteen_id,
            FoodProductionBatch.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return _payload(existing, _name(db, existing.menu_item_id)), True
    number = int(db.scalar(text("SELECT nextval('production_batch_no_seq')")) or 0)
    batch = FoodProductionBatch(
        canteen_id=canteen_id,
        menu_item_id=item.id,
        batch_code=f"PB-{number:06d}",
        service_date=service_date,
        service_period=service_period,
        produced_qty=produced_qty,
        served_counter_qty=0,
        remaining_qty=produced_qty,
        discarded_qty=0,
        prepared_at=prepared_at,
        notes=notes[:400],
        source="REAL",
        idempotency_key=idempotency_key,
        created_by=manager.id,
    )
    db.add(batch)
    db.flush()
    _event(
        db,
        batch,
        kind="OPEN",
        quantity=produced_qty,
        reason="Batch opened",
        actor_id=manager.id,
        key=idempotency_key,
    )
    audit(
        db,
        action="production.opened",
        actor_user_id=manager.id,
        target_type="food_production_batch",
        target_id=str(batch.id),
        canteen_id=canteen_id,
        metadata={"produced_qty": produced_qty, "menu_item_id": str(item.id)},
    )
    db.commit()
    return _payload(batch, item.name), False


def _lock(db: Session, canteen_id: UUID, batch_id: UUID) -> FoodProductionBatch:
    batch = db.scalar(
        select(FoodProductionBatch)
        .where(FoodProductionBatch.id == batch_id, FoodProductionBatch.canteen_id == canteen_id)
        .with_for_update()
    )
    if batch is None:
        raise ApiError(code="NOT_FOUND", message="Production batch not found.", status_code=404)
    return batch


def adjust_batch(
    db: Session,
    *,
    manager: User,
    batch_id: UUID,
    kind: str,
    quantity: int,
    reason: str,
    waste_reason: str | None,
    idempotency_key: str,
    clock: Clock = utcnow,
) -> tuple[dict, bool]:
    """Append a serving, discard, or correction. CORRECT sets the produced total."""

    canteen_id = manager_canteen_id(db, manager)
    if kind not in ("SERVE_COUNTER", "DISCARD", "CORRECT"):
        raise ApiError(code="VALIDATION_ERROR", message="Unknown adjustment.", status_code=422)
    if len(reason.strip()) < 3:
        raise ApiError(code="VALIDATION_ERROR", message="Give a short reason.", status_code=422)
    batch = _lock(db, canteen_id, batch_id)
    prior = db.scalar(
        select(ProductionQuantityEvent).where(
            ProductionQuantityEvent.batch_id == batch.id,
            ProductionQuantityEvent.idempotency_key == idempotency_key,
        )
    )
    if prior is not None:
        db.commit()
        return _payload(batch, _name(db, batch.menu_item_id)), True
    if kind == "CORRECT":
        if not 0 <= quantity <= 5000:
            raise ApiError(
                code="VALIDATION_ERROR",
                message="Quantity is out of range.",
                status_code=422,
            )
        used = batch.served_counter_qty + batch.discarded_qty
        if quantity < used:
            raise ApiError(
                code="CONFLICT",
                message="Produced portions cannot be less than servings plus discards.",
                status_code=409,
            )
        batch.produced_qty = quantity
        batch.remaining_qty = quantity - used
    else:
        if quantity < 1:
            raise ApiError(
                code="VALIDATION_ERROR",
                message="Quantity must be at least 1.",
                status_code=422,
            )
        if quantity > batch.remaining_qty:
            raise ApiError(
                code="CONFLICT",
                message="That is more than the portions still remaining in this batch.",
                status_code=409,
            )
        batch.remaining_qty -= quantity
        if kind == "SERVE_COUNTER":
            batch.served_counter_qty += quantity
        else:
            batch.discarded_qty += quantity
            why = waste_reason or "UNSOLD"
            if why not in WASTE_REASONS:
                raise ApiError(
                    code="VALIDATION_ERROR",
                    message="Unknown waste reason.",
                    status_code=422,
                )
            db.add(
                FoodWasteRecord(
                    canteen_id=canteen_id,
                    menu_item_id=batch.menu_item_id,
                    batch_id=batch.id,
                    service_date=batch.service_date,
                    service_period=batch.service_period,
                    quantity=quantity,
                    reason=why,
                    notes=reason[:400],
                    source="REAL",
                    idempotency_key=idempotency_key,
                    recorded_by=manager.id,
                    recorded_at=clock(),
                )
            )
    batch.version += 1
    batch.updated_at = clock()
    _event(
        db,
        batch,
        kind=kind,
        quantity=quantity,
        reason=reason,
        actor_id=manager.id,
        key=idempotency_key,
    )
    audit(
        db,
        action=f"production.{kind.lower()}",
        actor_user_id=manager.id,
        target_type="food_production_batch",
        target_id=str(batch.id),
        canteen_id=canteen_id,
        metadata={"quantity": quantity},
    )
    db.commit()
    return _payload(batch, _name(db, batch.menu_item_id)), False


def list_batches(
    db: Session,
    *,
    manager: User,
    date_from,
    date_to,
    menu_item_id: UUID | None,
    limit: int,
    offset: int,
) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    filters = [
        FoodProductionBatch.canteen_id == canteen_id,
        FoodProductionBatch.service_date >= date_from,
        FoodProductionBatch.service_date <= date_to,
    ]
    if menu_item_id is not None:
        filters.append(FoodProductionBatch.menu_item_id == menu_item_id)
    total = int(
        db.scalar(select(func.count()).select_from(FoodProductionBatch).where(*filters)) or 0
    )
    rows = db.scalars(
        select(FoodProductionBatch)
        .where(*filters)
        .order_by(FoodProductionBatch.service_date.desc(), FoodProductionBatch.batch_code)
        .limit(limit)
        .offset(offset)
    )
    return {
        "total": total,
        "batches": [_payload(row, _name(db, row.menu_item_id)) for row in rows],
    }


def get_batch(db: Session, *, manager: User, batch_id: UUID) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    batch = db.scalar(
        select(FoodProductionBatch).where(
            FoodProductionBatch.id == batch_id, FoodProductionBatch.canteen_id == canteen_id
        )
    )
    if batch is None:
        raise ApiError(code="NOT_FOUND", message="Production batch not found.", status_code=404)
    events = db.scalars(
        select(ProductionQuantityEvent)
        .where(ProductionQuantityEvent.batch_id == batch.id)
        .order_by(ProductionQuantityEvent.created_at)
    )
    body = _payload(batch, _name(db, batch.menu_item_id))
    body["events"] = [
        {
            "kind": event.kind,
            "quantity": event.quantity,
            "reason": event.reason,
            "produced_after": event.produced_after,
            "remaining_after": event.remaining_after,
            "created_at": event.created_at.isoformat(),
        }
        for event in events
    ]
    return body


def record_waste(
    db: Session,
    *,
    manager: User,
    menu_item_id: UUID,
    batch_id: UUID | None,
    service_date,
    service_period: str,
    quantity: int,
    reason: str,
    notes: str,
    idempotency_key: str,
    clock: Clock = utcnow,
) -> tuple[dict, bool]:
    canteen_id = manager_canteen_id(db, manager)
    if reason not in WASTE_REASONS:
        raise ApiError(code="VALIDATION_ERROR", message="Unknown waste reason.", status_code=422)
    if batch_id is not None:
        payload, replayed = adjust_batch(
            db,
            manager=manager,
            batch_id=batch_id,
            kind="DISCARD",
            quantity=quantity,
            reason=notes or reason,
            waste_reason=reason,
            idempotency_key=idempotency_key,
            clock=clock,
        )
        return {"batch": payload, "linked_to_batch": True}, replayed
    _item(db, canteen_id, menu_item_id)
    existing = db.scalar(
        select(FoodWasteRecord).where(
            FoodWasteRecord.canteen_id == canteen_id,
            FoodWasteRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return {
            "id": str(existing.id),
            "linked_to_batch": False,
            "quantity": existing.quantity,
        }, True
    if not 1 <= quantity <= 5000:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Quantity is out of range.",
            status_code=422,
        )
    if service_period not in PERIODS:
        raise ApiError(code="VALIDATION_ERROR", message="Unknown service period.", status_code=422)
    row = FoodWasteRecord(
        canteen_id=canteen_id,
        menu_item_id=menu_item_id,
        batch_id=None,
        service_date=service_date,
        service_period=service_period,
        quantity=quantity,
        reason=reason,
        notes=notes[:400],
        source="REAL",
        idempotency_key=idempotency_key,
        recorded_by=manager.id,
        recorded_at=clock(),
    )
    db.add(row)
    audit(
        db,
        action="waste.recorded",
        actor_user_id=manager.id,
        target_type="food_waste_record",
        target_id=str(row.id),
        canteen_id=canteen_id,
        metadata={"quantity": quantity, "reason": reason, "menu_item_id": str(menu_item_id)},
    )
    db.commit()
    return {
        "id": str(row.id),
        "linked_to_batch": False,
        "quantity": quantity,
        "reason": reason,
    }, False


def list_waste(
    db: Session,
    *,
    manager: User,
    date_from,
    date_to,
    menu_item_id: UUID | None,
    limit: int,
    offset: int,
) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    filters = [
        FoodWasteRecord.canteen_id == canteen_id,
        FoodWasteRecord.service_date >= date_from,
        FoodWasteRecord.service_date <= date_to,
        FoodWasteRecord.source == "REAL",
    ]
    if menu_item_id is not None:
        filters.append(FoodWasteRecord.menu_item_id == menu_item_id)
    total = int(db.scalar(select(func.count()).select_from(FoodWasteRecord).where(*filters)) or 0)
    rows = db.scalars(
        select(FoodWasteRecord)
        .where(*filters)
        .order_by(FoodWasteRecord.recorded_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return {
        "total": total,
        "records": [
            {
                "id": str(row.id),
                "menu_item_id": str(row.menu_item_id),
                "item_name": _name(db, row.menu_item_id),
                "batch_id": str(row.batch_id) if row.batch_id else None,
                "service_date": row.service_date.isoformat(),
                "quantity": row.quantity,
                "reason": row.reason,
                "notes": row.notes,
                "recorded_at": row.recorded_at.isoformat(),
                "source": row.source,
            }
            for row in rows
        ],
    }


def reconciliation(db: Session, *, manager: User, service_date) -> dict:
    """Compare batches with online pickups without adding them together."""

    canteen_id = manager_canteen_id(db, manager)
    batches = list(
        db.scalars(
            select(FoodProductionBatch).where(
                FoodProductionBatch.canteen_id == canteen_id,
                FoodProductionBatch.service_date == service_date,
                FoodProductionBatch.source == "REAL",
            )
        )
    )
    picked = dict(
        db.execute(
            select(OrderItem.menu_item_id, func.coalesce(func.sum(OrderItem.quantity), 0))
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                Order.canteen_id == canteen_id,
                Order.service_date == service_date,
                Order.status == "PICKED_UP",
            )
            .group_by(OrderItem.menu_item_id)
        ).all()
    )
    by_item: dict[UUID, dict] = {}
    for batch in batches:
        row = by_item.setdefault(
            batch.menu_item_id,
            {"produced": 0, "served_counter": 0, "remaining": 0, "discarded": 0},
        )
        row["produced"] += batch.produced_qty
        row["served_counter"] += batch.served_counter_qty
        row["remaining"] += batch.remaining_qty
        row["discarded"] += batch.discarded_qty
    items = []
    for item_id, totals in by_item.items():
        online = int(picked.get(item_id, 0))
        warnings = []
        if totals["served_counter"] and online:
            warnings.append(
                "Counter servings and online pickups are kept separate. "
                "Adding them can double-count the same portion."
            )
        if totals["served_counter"] + online > totals["produced"]:
            warnings.append(
                "Counter servings plus online pickups exceed this day's batches. "
                "The sets may overlap, or a batch is missing."
            )
        equation_ok = (
            totals["produced"]
            == totals["served_counter"] + totals["remaining"] + totals["discarded"]
        )
        items.append(
            {
                "menu_item_id": str(item_id),
                "item_name": _name(db, item_id),
                **totals,
                "online_picked_up": online,
                "equation_ok": equation_ok,
                "warnings": warnings,
            }
        )
    for item_id, online in picked.items():
        if item_id not in by_item:
            items.append(
                {
                    "menu_item_id": str(item_id),
                    "item_name": _name(db, item_id),
                    "produced": 0,
                    "served_counter": 0,
                    "remaining": 0,
                    "discarded": 0,
                    "online_picked_up": int(online),
                    "equation_ok": True,
                    "warnings": [
                        (
                            "These online pickups have no production batch on this date. "
                            "They are not counted as waste."
                        )
                    ],
                }
            )
    return {
        "service_date": service_date.isoformat(),
        "note": "Online pickups come from orders. They are not servings recorded on a batch.",
        "items": items,
    }


def set_closure(db: Session, *, manager: User, service_date, note: str, closed: bool) -> dict:
    canteen_id = manager_canteen_id(db, manager)
    row = db.scalar(
        select(CanteenClosure).where(
            CanteenClosure.canteen_id == canteen_id, CanteenClosure.service_date == service_date
        )
    )
    if closed and row is None:
        db.add(
            CanteenClosure(
                canteen_id=canteen_id,
                service_date=service_date,
                note=note[:200],
                created_by=manager.id,
            )
        )
    if not closed and row is not None:
        db.delete(row)
    db.commit()
    return {"service_date": service_date.isoformat(), "closed": closed}
