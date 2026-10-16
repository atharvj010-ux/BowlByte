"""Explainable food pairings. Manager links come first. Category words are only a fallback."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models.identity import User
from app.models.ordering import DailyStock, MenuCategory, MenuItem, MenuItemPairing
from app.services.ordering import (
    get_menu_item,
    item_view,
    manager_canteen_id,
    service_today,
)

DRINK_WORDS = ("beverage", "drink", "coffee", "juice", "shake", "cola", "soda")


def _clean_text(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if len(text) > limit:
        raise ApiError(code="VALIDATION_ERROR", message="That note is too long.", status_code=422)
    return text


def apply_nutrition(item: MenuItem, fields: dict) -> None:
    """Store calories only with an explicit source. Never invent a number."""
    touched = {
        "calories_kcal",
        "nutrition_source",
        "serving_size_description",
        "nutrition_reference",
    } & fields.keys()
    if not touched:
        return
    calories = fields["calories_kcal"] if "calories_kcal" in fields else item.calories_kcal
    source = fields["nutrition_source"] if "nutrition_source" in fields else item.nutrition_source
    serving = (
        fields["serving_size_description"]
        if "serving_size_description" in fields
        else item.serving_size_description
    )
    reference = (
        fields["nutrition_reference"]
        if "nutrition_reference" in fields
        else item.nutrition_reference
    )
    serving = _clean_text(serving, 80)
    reference = _clean_text(reference, 160)
    if calories is None and source is None:
        item.calories_kcal = None
        item.nutrition_source = None
        item.serving_size_description = serving
        item.nutrition_reference = None
        return
    if calories is None or source is None:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Set calories and a nutrition source together, or clear both.",
            status_code=422,
        )
    if source not in {"VERIFIED", "ILLUSTRATIVE"}:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Nutrition source must be verified or illustrative.",
            status_code=422,
        )
    if not isinstance(calories, int) or calories < 0 or calories > 5000:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Calories must be a whole number from 0 to 5000.",
            status_code=422,
        )
    item.calories_kcal = calories
    item.nutrition_source = source
    item.serving_size_description = serving
    item.nutrition_reference = reference


def _item_for_manager(db: Session, manager: User, item_id: UUID) -> MenuItem:
    canteen_id = manager_canteen_id(db, manager)
    item = db.get(MenuItem, item_id)
    if item is None or item.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    return item


def create_pairing(
    db: Session,
    *,
    manager: User,
    source_item_id: UUID,
    suggested_item_id: UUID,
    priority: int,
) -> MenuItemPairing:
    source = _item_for_manager(db, manager, source_item_id)
    suggested = _item_for_manager(db, manager, suggested_item_id)
    if source.id == suggested.id:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="An item cannot be paired with itself.",
            status_code=422,
        )
    if source.canteen_id != suggested.canteen_id:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Pairings stay inside one canteen.",
            status_code=422,
        )
    existing = db.scalar(
        select(MenuItemPairing).where(
            MenuItemPairing.source_item_id == source.id,
            MenuItemPairing.suggested_item_id == suggested.id,
        )
    )
    if existing is not None:
        raise ApiError(
            code="CONFLICT",
            message="That pairing already exists.",
            status_code=409,
        )
    row = MenuItemPairing(
        canteen_id=source.canteen_id,
        source_item_id=source.id,
        suggested_item_id=suggested.id,
        priority=priority,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_pairing(db: Session, *, manager: User, pairing_id: UUID) -> None:
    canteen_id = manager_canteen_id(db, manager)
    row = db.get(MenuItemPairing, pairing_id)
    if row is None or row.canteen_id != canteen_id:
        raise ApiError(code="NOT_FOUND", message="Pairing not found.", status_code=404)
    db.delete(row)
    db.commit()


def _views(db: Session, items: list[MenuItem], *, public: bool) -> list[dict]:
    if not items:
        return []
    categories = {
        row.id: row.name
        for row in db.scalars(
            select(MenuCategory).where(MenuCategory.canteen_id == items[0].canteen_id)
        )
    }
    stocks = {
        row.menu_item_id: row
        for row in db.scalars(
            select(DailyStock).where(
                DailyStock.menu_item_id.in_([item.id for item in items]),
                DailyStock.service_date == service_today(),
            )
        )
    }
    return [
        item_view(
            item,
            category_name=categories.get(item.category_id, ""),
            station=None,
            stock=stocks.get(item.id),
            include_reserved=not public,
        )
        for item in items
    ]


def _sellable(item: MenuItem, stock: DailyStock | None) -> bool:
    available = stock.available_qty if stock is not None else 0
    return item.is_active and item.is_available and available > 0


def list_pairings(db: Session, *, canteen_id: UUID, item_id: UUID, public: bool) -> dict:
    source = db.get(MenuItem, item_id)
    if source is None or source.canteen_id != canteen_id or (public and not source.is_active):
        raise ApiError(code="NOT_FOUND", message="Menu item not found.", status_code=404)
    links = list(
        db.scalars(
            select(MenuItemPairing)
            .where(
                MenuItemPairing.canteen_id == canteen_id,
                MenuItemPairing.source_item_id == source.id,
                MenuItemPairing.is_active.is_(True),
            )
            .order_by(MenuItemPairing.priority.desc(), MenuItemPairing.created_at)
        )
    )
    suggested_ids = [link.suggested_item_id for link in links]
    suggested = {
        item.id: item
        for item in db.scalars(select(MenuItem).where(MenuItem.id.in_(suggested_ids))).all()
    } if suggested_ids else {}
    stocks = {
        row.menu_item_id: row
        for row in db.scalars(
            select(DailyStock).where(
                DailyStock.menu_item_id.in_(suggested_ids or [source.id]),
                DailyStock.service_date == service_today(),
            )
        )
    }
    chosen: list[MenuItem] = []
    basis = "MANAGER"
    for link in links:
        item = suggested.get(link.suggested_item_id)
        if item is None or item.canteen_id != canteen_id:
            continue
        if public and not _sellable(item, stocks.get(item.id)):
            continue
        if not public and not item.is_active:
            continue
        chosen.append(item)
    if not chosen:
        basis = "CATEGORY"
        chosen = _category_fallback(db, source, public=public)
    return {
        "basis": basis,
        "items": _views(db, chosen[:4], public=public),
    }


def _category_fallback(db: Session, source: MenuItem, *, public: bool) -> list[MenuItem]:
    category = db.get(MenuCategory, source.category_id)
    source_name = (category.name if category else "").lower()
    source_is_drink = any(word in source_name for word in DRINK_WORDS)
    rows = list(
        db.scalars(
            select(MenuItem)
            .where(MenuItem.canteen_id == source.canteen_id, MenuItem.id != source.id)
            .order_by(MenuItem.name)
        )
    )
    categories = {
        row.id: row.name.lower()
        for row in db.scalars(
            select(MenuCategory).where(MenuCategory.canteen_id == source.canteen_id)
        )
    }
    stocks = {
        row.menu_item_id: row
        for row in db.scalars(
            select(DailyStock).where(
                DailyStock.menu_item_id.in_([row.id for row in rows] or [source.id]),
                DailyStock.service_date == service_today(),
            )
        )
    }
    matches: list[MenuItem] = []
    for item in rows:
        if public and not _sellable(item, stocks.get(item.id)):
            continue
        if not public and not item.is_active:
            continue
        name = categories.get(item.category_id, "")
        is_drink = any(word in name for word in DRINK_WORDS)
        if source_is_drink and is_drink:
            continue
        if not source_is_drink and not is_drink:
            continue
        matches.append(item)
    return matches


def manager_pairings(db: Session, *, manager: User, item_id: UUID) -> list[dict]:
    source = _item_for_manager(db, manager, item_id)
    links = list(
        db.scalars(
            select(MenuItemPairing)
            .where(MenuItemPairing.source_item_id == source.id)
            .order_by(MenuItemPairing.priority.desc())
        )
    )
    names = {
        item.id: item.name
        for item in db.scalars(
            select(MenuItem).where(
                MenuItem.id.in_([link.suggested_item_id for link in links] or [source.id])
            )
        )
    }
    return [
        {
            "id": link.id,
            "suggested_item_id": link.suggested_item_id,
            "suggested_name": names.get(link.suggested_item_id, ""),
            "priority": link.priority,
            "is_active": link.is_active,
        }
        for link in links
    ]


def public_item_or_404(db: Session, *, canteen_id: UUID, item_id: UUID) -> dict:
    return get_menu_item(db, canteen_id=canteen_id, item_id=item_id, public=True)
