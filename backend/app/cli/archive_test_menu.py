"""Soft-archive automated-test menu rows and place the demo dishes.

Dry-run is the default. ``--apply`` writes the plan in one transaction and
saves the previous values so ``--rollback`` can restore them. Orders, prices,
and stock quantities are not modified.
"""

import json
import sys
from pathlib import Path

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.ordering import DailyStock, InventoryAdjustment, MenuCategory, MenuItem
from app.services.menu_cleanup import DEMO_PLACES, CategoryRow, ItemRow, plan_cleanup
from app.services.ordering import service_today

ROLLBACK = Path(__file__).resolve().parents[2] / "var" / "menu_cleanup_rollback.json"


def _load():
    db = SessionLocal()
    categories = [
        CategoryRow(
            id=row.id,
            name=row.name,
            sort_order=row.sort_order,
            is_active=row.is_active,
            is_demo=row.is_demo,
        )
        for row in db.scalars(select(MenuCategory).order_by(MenuCategory.name, MenuCategory.id))
    ]
    items = [
        ItemRow(
            id=row.id,
            name=row.name,
            category_id=row.category_id,
            seed_key=row.seed_key,
            is_active=row.is_active,
            sort_order=row.sort_order,
        )
        for row in db.scalars(select(MenuItem).order_by(MenuItem.name, MenuItem.id))
    ]
    return db, categories, items


def _report(categories, items, plan) -> None:
    print(f"categories={len(categories)} items={len(items)}")
    print(f"archive_categories={len(plan.archive_category_ids)}")
    print(f"archive_items={len(plan.archive_item_ids)}")
    print(f"create_categories={sorted(plan.create_categories)}")
    print(f"demo_moves={len(plan.item_moves)}")
    print(f"category_sort_updates={len(plan.category_sort)}")
    for note in plan.review:
        print(f"REVIEW {note}")
    if not plan.changed and not plan.review:
        print("No menu cleanup is waiting.")


def ensure_demo_stock(db) -> int:
    """Open today's counter stock for demo dishes that have no row yet."""

    day = service_today()
    opened = 0
    items = db.scalars(select(MenuItem).where(MenuItem.seed_key.in_(tuple(DEMO_PLACES)))).all()
    for item in items:
        existing = db.scalar(
            select(DailyStock).where(
                DailyStock.menu_item_id == item.id,
                DailyStock.service_date == day,
            )
        )
        if existing is not None:
            continue
        stock = DailyStock(menu_item_id=item.id, service_date=day, available_qty=20)
        db.add(stock)
        db.flush()
        db.add(
            InventoryAdjustment(
                daily_stock_id=stock.id,
                menu_item_id=item.id,
                delta_available=20,
                delta_reserved=0,
                reason="demo_seed",
            )
        )
        opened += 1
    return opened


def apply_plan() -> int:
    db, categories, items = _load()
    plan = plan_cleanup(categories, items)
    _report(categories, items, plan)
    if plan.review:
        print("Nothing was written. Resolve the review lines first.")
        db.close()
        return 1
    opened = ensure_demo_stock(db)
    print(f"demo_stock_opened={opened}")
    if not plan.changed:
        db.commit()
        db.close()
        return 0
    category_rows = {row.id: row for row in db.scalars(select(MenuCategory))}
    item_rows = {row.id: row for row in db.scalars(select(MenuItem))}
    rollback = {"categories": [], "items": []}
    try:
        for name, sort_order in plan.create_categories.items():
            canteen_id = next(iter(category_rows.values())).canteen_id
            created = MenuCategory(
                canteen_id=canteen_id,
                name=name,
                sort_order=sort_order,
                is_active=True,
                is_demo=True,
            )
            db.add(created)
            db.flush()
            category_rows[created.id] = created
        names = {row.name: row for row in category_rows.values()}
        for category_id, sort_order in plan.category_sort.items():
            row = category_rows[category_id]
            rollback["categories"].append(
                {"id": str(row.id), "is_active": row.is_active, "sort_order": row.sort_order}
            )
            row.sort_order = sort_order
            row.is_active = True
        for item_id, (category_name, sort_order) in plan.item_moves.items():
            row = item_rows[item_id]
            rollback["items"].append(
                {
                    "id": str(row.id),
                    "category_id": str(row.category_id),
                    "sort_order": row.sort_order,
                    "is_active": row.is_active,
                }
            )
            row.category_id = names[category_name].id
            row.sort_order = sort_order
        for category_id in plan.archive_category_ids:
            row = category_rows[category_id]
            if not any(entry["id"] == str(row.id) for entry in rollback["categories"]):
                rollback["categories"].append(
                    {"id": str(row.id), "is_active": row.is_active, "sort_order": row.sort_order}
                )
            row.is_active = False
        for item_id in plan.archive_item_ids:
            row = item_rows[item_id]
            if not any(entry["id"] == str(row.id) for entry in rollback["items"]):
                rollback["items"].append(
                    {
                        "id": str(row.id),
                        "category_id": str(row.category_id),
                        "sort_order": row.sort_order,
                        "is_active": row.is_active,
                    }
                )
            row.is_active = False
        db.commit()
    except Exception:
        db.rollback()
        db.close()
        raise
    db.close()
    ROLLBACK.parent.mkdir(parents=True, exist_ok=True)
    ROLLBACK.write_text(json.dumps(rollback), encoding="utf-8")
    print(f"Applied. Rollback file: {ROLLBACK}")
    return 0


def rollback() -> int:
    if not ROLLBACK.exists():
        print("No rollback file is present.")
        return 1
    payload = json.loads(ROLLBACK.read_text(encoding="utf-8"))
    db = SessionLocal()
    try:
        for entry in payload["categories"]:
            row = db.get(MenuCategory, entry["id"])
            if row is None:
                continue
            row.is_active = entry["is_active"]
            row.sort_order = entry["sort_order"]
        for entry in payload["items"]:
            row = db.get(MenuItem, entry["id"])
            if row is None:
                continue
            row.category_id = entry["category_id"]
            row.sort_order = entry["sort_order"]
            row.is_active = entry["is_active"]
        db.commit()
    except Exception:
        db.rollback()
        db.close()
        raise
    db.close()
    print("Restored the saved category and item fields.")
    return 0


def main() -> int:
    if "--rollback" in sys.argv:
        return rollback()
    if "--apply" in sys.argv:
        return apply_plan()
    db, categories, items = _load()
    plan = plan_cleanup(categories, items)
    db.close()
    _report(categories, items, plan)
    print("Dry run only. Pass --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
