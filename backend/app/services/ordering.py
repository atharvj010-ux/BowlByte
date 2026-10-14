"""Menu, stock reservation, and cash-on-pickup placement.

Placement and cancellation each commit once. A failure rolls the session back
when the request session closes, and this module rolls back itself when it
must recover an idempotency race.
"""

import hashlib
import json
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.identity import (
    ACTIVE,
    CANTEEN_MANAGER,
    KITCHEN_STAFF,
    MEMBERSHIP_ACTIVE,
    Canteen,
    StaffMembership,
    User,
)
from app.models.ordering import (
    CASH,
    DailyStock,
    InventoryAdjustment,
    KitchenStation,
    MenuCategory,
    MenuItem,
    MenuItemStationAssignment,
    Order,
    OrderEvent,
    OrderIdempotencyRecord,
    OrderItem,
    OrderPayment,
)
from app.services.images import decode_image

LOW_STOCK_AT = 5
UNAVAILABLE = "That item is not available."


def service_today() -> date:
    return datetime.now(UTC).date()


def pilot_canteen(db: Session) -> Canteen:
    canteen = db.scalar(select(Canteen).where(Canteen.slug == get_settings().canteen_slug))
    if canteen is None:
        raise ApiError(
            code="CANTEEN_NOT_READY",
            message="The pilot canteen is not ready.",
            status_code=503,
        )
    return canteen


def _membership(db: Session, user: User, role: str) -> StaffMembership:
    if user.role != role or user.status != ACTIVE:
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    membership = db.scalar(
        select(StaffMembership).where(
            StaffMembership.user_id == user.id,
            StaffMembership.role == role,
            StaffMembership.status == MEMBERSHIP_ACTIVE,
        )
    )
    if membership is None:
        raise ApiError(code="FORBIDDEN", message="You cannot open this area.", status_code=403)
    return membership


def manager_canteen_id(db: Session, user: User) -> UUID:
    return _membership(db, user, CANTEEN_MANAGER).canteen_id


def kitchen_canteen_id(db: Session, user: User) -> UUID:
    return _membership(db, user, KITCHEN_STAFF).canteen_id


def _clean_note(note: str | None) -> str | None:
    if note is None:
        return None
    cleaned = " ".join(note.split())
    if not cleaned:
        return None
    if len(cleaned) > 240 or any(ord(char) < 32 for char in cleaned):
        raise ApiError(
            code="VALIDATION_ERROR",
            message="The note is not valid.",
            status_code=422,
        )
    return cleaned


def request_hash(items: list[tuple[UUID, int]], note: str | None) -> str:
    payload = {
        "items": [
            {"menu_item_id": str(item_id), "quantity": quantity}
            for item_id, quantity in sorted(items, key=lambda row: str(row[0]))
        ],
        "note": note or "",
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _lock_idempotency(db: Session, student_id: UUID, key: str) -> None:
    digest = int.from_bytes(
        hashlib.sha256(f"{student_id}:{key}".encode()).digest()[:8],
        "big",
        signed=True,
    )
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": digest})


def _touch(row: MenuItem | KitchenStation | DailyStock | Order) -> None:
    row.updated_at = datetime.now(UTC)


def create_category(db: Session, *, manager: User, name: str, sort_order: int) -> MenuCategory:
    canteen_id = manager_canteen_id(db, manager)
    category = MenuCategory(
        canteen_id=canteen_id,
        name=name.strip(),
        sort_order=sort_order,
    )
    db.add(category)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            code="CONFLICT",
            message="That category already exists.",
            status_code=409,
        ) from exc
    db.refresh(category)
    return category


def update_category(
    db: Session,
    *,
    manager: User,
    category_id: UUID,
    name: str | None,
    sort_order: int | None,
) -> MenuCategory:
    canteen_id = manager_canteen_id(db, manager)
    category = db.get(MenuCategory, category_id)
    if category is None or category.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Category not found.", status_code=404)
    if name is not None:
        category.name = name.strip()
    if sort_order is not None:
        category.sort_order = sort_order
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            code="CONFLICT",
            message="That category already exists.",
            status_code=409,
        ) from exc
    db.refresh(category)
    return category


def list_categories(db: Session, *, canteen_id: UUID, public: bool) -> list[MenuCategory]:
    query = select(MenuCategory).where(MenuCategory.canteen_id == canteen_id)
    if public:
        query = query.where(
            MenuCategory.id.in_(
                select(MenuItem.category_id).where(
                    MenuItem.canteen_id == canteen_id,
                    MenuItem.is_active.is_(True),
                )
            )
        )
    return list(db.scalars(query.order_by(MenuCategory.sort_order, MenuCategory.name)))


def create_station(
    db: Session,
    *,
    manager: User,
    name: str,
    parallel_capacity: int,
) -> KitchenStation:
    station = KitchenStation(
        canteen_id=manager_canteen_id(db, manager),
        name=name.strip(),
        parallel_capacity=parallel_capacity,
    )
    db.add(station)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            code="CONFLICT",
            message="That station already exists.",
            status_code=409,
        ) from exc
    db.refresh(station)
    return station


def update_station(
    db: Session,
    *,
    manager: User,
    station_id: UUID,
    name: str | None,
    parallel_capacity: int | None,
    is_active: bool | None,
) -> KitchenStation:
    canteen_id = manager_canteen_id(db, manager)
    station = db.get(KitchenStation, station_id)
    if station is None or station.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Station not found.", status_code=404)
    if name is not None:
        station.name = name.strip()
    if parallel_capacity is not None:
        station.parallel_capacity = parallel_capacity
    if is_active is not None:
        station.is_active = is_active
    _touch(station)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            code="CONFLICT",
            message="That station already exists.",
            status_code=409,
        ) from exc
    db.refresh(station)
    return station


def list_stations(db: Session, *, canteen_id: UUID) -> list[KitchenStation]:
    return list(
        db.scalars(
            select(KitchenStation)
            .where(KitchenStation.canteen_id == canteen_id)
            .order_by(KitchenStation.name)
        )
    )


def _category_in_canteen(db: Session, category_id: UUID, canteen_id: UUID) -> MenuCategory:
    category = db.get(MenuCategory, category_id)
    if category is None or category.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Category not found.", status_code=404)
    return category


def _station_in_canteen(db: Session, station_id: UUID, canteen_id: UUID) -> KitchenStation:
    station = db.get(KitchenStation, station_id)
    if station is None or station.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Station not found.", status_code=404)
    return station


def _assign_station(db: Session, item: MenuItem, station_id: UUID) -> None:
    assignment = db.scalar(
        select(MenuItemStationAssignment).where(MenuItemStationAssignment.menu_item_id == item.id)
    )
    if assignment is None:
        db.add(MenuItemStationAssignment(menu_item_id=item.id, station_id=station_id))
    else:
        assignment.station_id = station_id


def create_menu_item(db: Session, *, manager: User, fields: dict) -> MenuItem:
    canteen_id = manager_canteen_id(db, manager)
    _category_in_canteen(db, fields["category_id"], canteen_id)
    _station_in_canteen(db, fields["station_id"], canteen_id)
    item = MenuItem(
        canteen_id=canteen_id,
        category_id=fields["category_id"],
        name=fields["name"].strip(),
        description=fields["description"].strip(),
        price_paise=fields["price_paise"],
        prep_seconds=fields["prep_seconds"],
        is_active=fields["is_active"],
        is_available=fields["is_available"],
    )
    db.add(item)
    db.flush()
    _assign_station(db, item, fields["station_id"])
    initial = fields.get("initial_available_qty")
    if initial is not None:
        stock = DailyStock(
            menu_item_id=item.id,
            service_date=service_today(),
            available_qty=initial,
        )
        db.add(stock)
        db.flush()
        db.add(
            InventoryAdjustment(
                daily_stock_id=stock.id,
                menu_item_id=item.id,
                actor_user_id=manager.id,
                delta_available=initial,
                delta_reserved=0,
                reason="manager_set",
            )
        )
    db.commit()
    db.refresh(item)
    return item


def update_menu_item(db: Session, *, manager: User, item_id: UUID, fields: dict) -> MenuItem:
    canteen_id = manager_canteen_id(db, manager)
    item = db.get(MenuItem, item_id)
    if item is None or item.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    if "category_id" in fields:
        _category_in_canteen(db, fields["category_id"], canteen_id)
        item.category_id = fields["category_id"]
    if "station_id" in fields:
        _station_in_canteen(db, fields["station_id"], canteen_id)
        _assign_station(db, item, fields["station_id"])
    for key in ("name", "description"):
        if key in fields:
            setattr(item, key, fields[key].strip())
    for key in ("price_paise", "prep_seconds", "is_active", "is_available"):
        if key in fields:
            setattr(item, key, fields[key])
    _touch(item)
    db.commit()
    db.refresh(item)
    return item


def set_item_image(
    db: Session,
    *,
    manager: User,
    item_id: UUID,
    content_base64: str,
    content_type: str,
) -> MenuItem:
    canteen_id = manager_canteen_id(db, manager)
    item = db.get(MenuItem, item_id)
    if item is None or item.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    item.image_bytes = decode_image(content_base64, content_type)
    item.image_content_type = content_type
    _touch(item)
    db.commit()
    db.refresh(item)
    return item


def get_image(db: Session, item_id: UUID, *, canteen_id: UUID) -> tuple[bytes, str]:
    item = db.get(MenuItem, item_id)
    if (
        item is None
        or item.canteen_id != canteen_id
        or not item.is_active
        or item.image_bytes is None
        or item.image_content_type is None
    ):
        raise ApiError(code="NOT_FOUND", message="Image not found.", status_code=404)
    return item.image_bytes, item.image_content_type


def _station_map(db: Session, item_ids: list[UUID]) -> dict[UUID, KitchenStation]:
    if not item_ids:
        return {}
    rows = db.execute(
        select(MenuItemStationAssignment.menu_item_id, KitchenStation)
        .join(KitchenStation, KitchenStation.id == MenuItemStationAssignment.station_id)
        .where(MenuItemStationAssignment.menu_item_id.in_(item_ids))
    ).all()
    return {item_id: station for item_id, station in rows}


def _stock_map(db: Session, item_ids: list[UUID], day: date) -> dict[UUID, DailyStock]:
    if not item_ids:
        return {}
    rows = db.scalars(
        select(DailyStock).where(
            DailyStock.menu_item_id.in_(item_ids),
            DailyStock.service_date == day,
        )
    ).all()
    return {row.menu_item_id: row for row in rows}


def item_view(
    item: MenuItem,
    *,
    category_name: str,
    station: KitchenStation | None,
    stock: DailyStock | None,
    include_reserved: bool,
) -> dict:
    available = stock.available_qty if stock is not None else 0
    return {
        "id": item.id,
        "category_id": item.category_id,
        "category_name": category_name,
        "station_id": station.id if station else None,
        "station_name": station.name if station else None,
        "name": item.name,
        "description": item.description,
        "price_paise": item.price_paise,
        "prep_seconds": item.prep_seconds,
        "is_active": item.is_active,
        "is_available": item.is_available,
        "is_demo": item.is_demo,
        "image_url": f"/api/v1/menu/items/{item.id}/image" if item.image_content_type else None,
        "available_qty": available,
        "reserved_qty": stock.reserved_qty if include_reserved and stock is not None else None,
    }


def list_menu_items(
    db: Session,
    *,
    canteen_id: UUID,
    public: bool,
    query: str | None,
    category_id: UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    filters = [MenuItem.canteen_id == canteen_id]
    if public:
        filters.append(MenuItem.is_active.is_(True))
    if category_id is not None:
        filters.append(MenuItem.category_id == category_id)
    if query:
        safe = query.strip()[:80].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(MenuItem.name.ilike(f"%{safe}%", escape="\\"))
    total = db.scalar(select(func.count()).select_from(MenuItem).where(*filters)) or 0
    items = list(
        db.scalars(
            select(MenuItem).where(*filters).order_by(MenuItem.name).limit(limit).offset(offset)
        )
    )
    categories = {
        row.id: row.name
        for row in db.scalars(select(MenuCategory).where(MenuCategory.canteen_id == canteen_id))
    }
    stations = _station_map(db, [item.id for item in items])
    stocks = _stock_map(db, [item.id for item in items], service_today())
    views = [
        item_view(
            item,
            category_name=categories.get(item.category_id, ""),
            station=stations.get(item.id),
            stock=stocks.get(item.id),
            include_reserved=not public,
        )
        for item in items
    ]
    return views, int(total)


def get_menu_item(db: Session, *, canteen_id: UUID, item_id: UUID, public: bool) -> dict:
    item = db.get(MenuItem, item_id)
    if item is None or item.canteen_id != canteen_id or (public and not item.is_active):
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    category = db.get(MenuCategory, item.category_id)
    stations = _station_map(db, [item.id])
    stocks = _stock_map(db, [item.id], service_today())
    return item_view(
        item,
        category_name=category.name if category else "",
        station=stations.get(item.id),
        stock=stocks.get(item.id),
        include_reserved=not public,
    )


def _lock_stock(db: Session, item_ids: list[UUID], day: date) -> dict[UUID, DailyStock]:
    rows = db.scalars(
        select(DailyStock)
        .where(DailyStock.menu_item_id.in_(item_ids), DailyStock.service_date == day)
        .order_by(DailyStock.menu_item_id)
        .with_for_update()
    ).all()
    return {row.menu_item_id: row for row in rows}


def set_available_stock(
    db: Session,
    *,
    manager: User,
    item_id: UUID,
    available_qty: int,
    reason: str,
) -> DailyStock:
    canteen_id = manager_canteen_id(db, manager)
    item = db.get(MenuItem, item_id)
    if item is None or item.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    day = service_today()
    stock = db.scalar(
        select(DailyStock)
        .where(DailyStock.menu_item_id == item.id, DailyStock.service_date == day)
        .with_for_update()
    )
    if stock is None:
        stock = DailyStock(menu_item_id=item.id, service_date=day, available_qty=0)
        db.add(stock)
        db.flush()
    delta = available_qty - stock.available_qty
    stock.available_qty = available_qty
    _touch(stock)
    db.add(
        InventoryAdjustment(
            daily_stock_id=stock.id,
            menu_item_id=item.id,
            actor_user_id=manager.id,
            delta_available=delta,
            delta_reserved=0,
            reason=" ".join(reason.split())[:80],
        )
    )
    db.commit()
    db.refresh(stock)
    return stock


def list_stock(db: Session, *, canteen_id: UUID, day: date) -> list[dict]:
    items = list(
        db.scalars(
            select(MenuItem).where(MenuItem.canteen_id == canteen_id).order_by(MenuItem.name)
        )
    )
    stocks = _stock_map(db, [item.id for item in items], day)
    rows = []
    for item in items:
        stock = stocks.get(item.id)
        available = stock.available_qty if stock else 0
        reserved = stock.reserved_qty if stock else 0
        consumed = stock.consumed_qty if stock else 0
        rows.append(
            {
                "menu_item_id": item.id,
                "name": item.name,
                "service_date": day,
                "available_qty": available,
                "reserved_qty": reserved,
                "consumed_qty": consumed,
                "is_active": item.is_active,
                "is_available": item.is_available,
                "low_stock": available <= LOW_STOCK_AT,
                "out_of_stock": available == 0,
            }
        )
    return rows


def _normalize_lines(lines: list[tuple[UUID, int]]) -> list[tuple[UUID, int]]:
    seen: set[UUID] = set()
    normalized: list[tuple[UUID, int]] = []
    for item_id, quantity in lines:
        if item_id in seen:
            raise ApiError(
                code="VALIDATION_ERROR",
                message="Each item can appear only once.",
                status_code=422,
            )
        seen.add(item_id)
        normalized.append((item_id, quantity))
    return normalized


def _order_payload(db: Session, order: Order, *, include_student: bool) -> dict:
    items = list(
        db.scalars(
            select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.item_name)
        )
    )
    payment = db.scalar(select(OrderPayment).where(OrderPayment.order_id == order.id))
    if payment is None:
        raise ApiError(code="INTERNAL_ERROR", message="Order payment is missing.", status_code=500)
    student_name = None
    if include_student:
        student = db.get(User, order.student_user_id)
        student_name = student.full_name if student else None
    return {
        "id": order.id,
        "ticket_number": order.ticket_number,
        "status": order.status,
        "total_paise": order.total_paise,
        "note": order.note,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "canteen_id": order.canteen_id,
        "student_name": student_name,
        "payment": {
            "method": payment.method,
            "status": payment.status,
            "amount_paise": payment.amount_paise,
        },
        "items": [
            {
                "menu_item_id": line.menu_item_id,
                "item_name": line.item_name,
                "unit_price_paise": line.unit_price_paise,
                "quantity": line.quantity,
                "line_total_paise": line.line_total_paise,
                "station_name": line.station_name,
                "prep_seconds": line.prep_seconds,
            }
            for line in items
        ],
    }


def _find_idempotency(
    db: Session,
    *,
    student_id: UUID,
    key: str,
) -> OrderIdempotencyRecord | None:
    return db.scalar(
        select(OrderIdempotencyRecord).where(
            OrderIdempotencyRecord.student_user_id == student_id,
            OrderIdempotencyRecord.idempotency_key == key,
        )
    )


def place_order(
    db: Session,
    *,
    student: User,
    lines: list[tuple[UUID, int]],
    note: str | None,
    idempotency_key: str,
) -> dict:
    if student.role != "STUDENT" or student.status != ACTIVE:
        raise ApiError(code="FORBIDDEN", message="You cannot place an order.", status_code=403)
    cleaned = _clean_note(note)
    normalized = _normalize_lines(lines)
    digest = request_hash(normalized, cleaned)
    canteen = pilot_canteen(db)
    day = service_today()
    _lock_idempotency(db, student.id, idempotency_key)
    existing = _find_idempotency(db, student_id=student.id, key=idempotency_key)
    if existing is not None:
        if existing.request_hash != digest:
            raise ApiError(
                code="IDEMPOTENCY_CONFLICT",
                message="This checkout was already used for a different order.",
                status_code=409,
            )
        order = db.get(Order, existing.order_id)
        if order is None:
            raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
        return _order_payload(db, order, include_student=False)

    item_ids = [item_id for item_id, _quantity in normalized]
    items = {
        item.id: item
        for item in db.scalars(
            select(MenuItem)
            .where(MenuItem.id.in_(item_ids))
            .order_by(MenuItem.id)
            .with_for_update()
        ).all()
    }
    if len(items) != len(item_ids) or any(
        items[item_id].canteen_id != canteen.id for item_id in item_ids
    ):
        raise ApiError(code="INVALID_ORDER", message=UNAVAILABLE, status_code=400)
    for item in items.values():
        if not item.is_active or not item.is_available:
            raise ApiError(code="INVALID_ORDER", message=UNAVAILABLE, status_code=400)

    stocks = _lock_stock(db, sorted(item_ids, key=str), day)
    stations = _station_map(db, item_ids)
    total = 0
    snapshots: list[dict] = []
    for item_id, quantity in normalized:
        item = items[item_id]
        stock = stocks.get(item_id)
        available = stock.available_qty if stock is not None else 0
        if available < quantity:
            raise ApiError(
                code="INSUFFICIENT_STOCK",
                message="Not enough portions are left.",
                status_code=409,
            )
        line_total = item.price_paise * quantity
        total += line_total
        station = stations.get(item_id)
        snapshots.append(
            {
                "item": item,
                "stock": stock,
                "quantity": quantity,
                "line_total": line_total,
                "station": station,
            }
        )

    ticket = db.execute(text("SELECT nextval('order_ticket_seq')")).scalar_one()
    order = Order(
        ticket_number=f"B{int(ticket):05d}",
        student_user_id=student.id,
        canteen_id=canteen.id,
        status="PLACED",
        total_paise=total,
        payment_method=CASH,
        note=cleaned,
        service_date=day,
    )
    db.add(order)
    db.flush()
    for snapshot in snapshots:
        stock = snapshot["stock"]
        assert stock is not None
        quantity = snapshot["quantity"]
        stock.available_qty -= quantity
        stock.reserved_qty += quantity
        _touch(stock)
        station = snapshot["station"]
        item = snapshot["item"]
        db.add(
            OrderItem(
                order_id=order.id,
                menu_item_id=item.id,
                item_name=item.name,
                unit_price_paise=item.price_paise,
                quantity=quantity,
                line_total_paise=snapshot["line_total"],
                station_id=station.id if station else None,
                station_name=station.name if station else None,
                prep_seconds=item.prep_seconds,
            )
        )
        db.add(
            InventoryAdjustment(
                daily_stock_id=stock.id,
                menu_item_id=item.id,
                actor_user_id=student.id,
                order_id=order.id,
                delta_available=-quantity,
                delta_reserved=quantity,
                reason="order_reserve",
            )
        )
    db.add(
        OrderPayment(
            order_id=order.id,
            method=CASH,
            status="PENDING",
            amount_paise=total,
        )
    )
    db.add(
        OrderEvent(
            order_id=order.id,
            from_status=None,
            to_status="PLACED",
            actor_user_id=student.id,
        )
    )
    db.add(
        OrderIdempotencyRecord(
            student_user_id=student.id,
            idempotency_key=idempotency_key,
            request_hash=digest,
            order_id=order.id,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raced = _find_idempotency(db, student_id=student.id, key=idempotency_key)
        if raced is not None and raced.request_hash == digest:
            saved = db.get(Order, raced.order_id)
            if saved is not None:
                return _order_payload(db, saved, include_student=False)
        raise ApiError(
            code="IDEMPOTENCY_CONFLICT",
            message="This checkout could not be saved.",
            status_code=409,
        ) from exc
    db.refresh(order)
    return _order_payload(db, order, include_student=False)


def cancel_order(db: Session, *, student: User, order_id: UUID) -> dict:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.student_user_id == student.id)
        .with_for_update()
    )
    if order is None:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    if order.status == "CANCELLED":
        return _order_payload(db, order, include_student=False)
    if order.status != "PLACED":
        raise ApiError(
            code="CONFLICT",
            message="This order can no longer be cancelled.",
            status_code=409,
        )
    lines = list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)))
    item_ids = sorted((line.menu_item_id for line in lines), key=str)
    stocks = _lock_stock(db, item_ids, order.service_date)
    for line in lines:
        stock = stocks.get(line.menu_item_id)
        if stock is None or stock.reserved_qty < line.quantity:
            raise ApiError(
                code="CONFLICT",
                message="Reserved stock could not be released.",
                status_code=409,
            )
        stock.reserved_qty -= line.quantity
        stock.available_qty += line.quantity
        _touch(stock)
        db.add(
            InventoryAdjustment(
                daily_stock_id=stock.id,
                menu_item_id=line.menu_item_id,
                actor_user_id=student.id,
                order_id=order.id,
                delta_available=line.quantity,
                delta_reserved=-line.quantity,
                reason="order_release",
            )
        )
    order.status = "CANCELLED"
    order.version += 1
    _touch(order)
    db.add(
        OrderEvent(
            order_id=order.id,
            from_status="PLACED",
            to_status="CANCELLED",
            actor_user_id=student.id,
            reason="student_cancel",
        )
    )
    db.commit()
    db.refresh(order)
    return _order_payload(db, order, include_student=False)


def list_student_orders(
    db: Session,
    *,
    student: User,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    filters = [Order.student_user_id == student.id]
    total = db.scalar(select(func.count()).select_from(Order).where(*filters)) or 0
    orders = list(
        db.scalars(
            select(Order)
            .where(*filters)
            .order_by(Order.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return [_order_payload(db, order, include_student=False) for order in orders], int(total)


def get_student_order(db: Session, *, student: User, order_id: UUID) -> dict:
    order = db.scalar(
        select(Order).where(Order.id == order_id, Order.student_user_id == student.id)
    )
    if order is None:
        raise ApiError(code="NOT_FOUND", message="Order not found.", status_code=404)
    return _order_payload(db, order, include_student=False)


def list_kitchen_orders(
    db: Session,
    *,
    staff: User,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    canteen_id = kitchen_canteen_id(db, staff)
    filters = [Order.canteen_id == canteen_id, Order.status == "PLACED"]
    total = db.scalar(select(func.count()).select_from(Order).where(*filters)) or 0
    orders = list(
        db.scalars(
            select(Order).where(*filters).order_by(Order.created_at).limit(limit).offset(offset)
        )
    )
    return [_order_payload(db, order, include_student=False) for order in orders], int(total)


def list_manager_orders(
    db: Session,
    *,
    manager: User,
    status: str | None,
    on: date | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int, dict]:
    canteen_id = manager_canteen_id(db, manager)
    filters = [Order.canteen_id == canteen_id]
    if status is not None:
        filters.append(Order.status == status)
    if on is not None:
        filters.append(Order.service_date == on)
    total = db.scalar(select(func.count()).select_from(Order).where(*filters)) or 0
    orders = list(
        db.scalars(
            select(Order)
            .where(*filters)
            .order_by(Order.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    placed = db.scalar(
        select(func.coalesce(func.sum(Order.total_paise), 0)).where(
            Order.canteen_id == canteen_id,
            Order.status == "PLACED",
            *([Order.service_date == on] if on else []),
        )
    )
    cancelled = db.scalar(
        select(func.coalesce(func.sum(Order.total_paise), 0)).where(
            Order.canteen_id == canteen_id,
            Order.status == "CANCELLED",
            *([Order.service_date == on] if on else []),
        )
    )
    totals = {
        "placed_paise": int(placed or 0),
        "cancelled_paise": int(cancelled or 0),
        "cash_collected_paise": None,
        "cash_collected_note": (
            "Cash collection is not recorded until a cashier confirms payment."
        ),
    }
    return (
        [_order_payload(db, order, include_student=True) for order in orders],
        int(total),
        totals,
    )
