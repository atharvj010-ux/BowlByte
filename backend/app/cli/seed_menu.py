"""Load development menu, station, and stock samples.

The command is idempotent. It does not create users, orders, or payments.
Sample rows are marked is_demo and are not production data.
"""

import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.identity import Canteen
from app.models.ordering import (
    DailyStock,
    InventoryAdjustment,
    KitchenStation,
    MenuCategory,
    MenuItem,
    MenuItemStationAssignment,
)
from app.services.identity import ensure_college
from app.services.ordering import service_today

CATEGORY_ORDER = {
    "Breakfast": 10,
    "Quick Bites & Snacks": 20,
    "Sandwiches & Toasties": 30,
    "Rice & Noodles": 40,
    "Beverages": 50,
}

SAMPLES = [
    {
        "category": "Breakfast",
        "station": "Hot Food Station",
        "capacity": 2,
        "name": "Masala Dosa",
        "seed_key": "demo:masala-dosa",
        "description": "Development sample. Rice crepe with potato masala.",
        "price_paise": 6000,
        "prep_seconds": 480,
        "stock": 20,
    },
    {
        "category": "Sandwiches & Toasties",
        "station": "Sandwich Station",
        "capacity": 2,
        "name": "Veg Sandwich",
        "seed_key": "demo:veg-sandwich",
        "description": "Development sample. Toasted vegetable sandwich.",
        "price_paise": 4000,
        "prep_seconds": 300,
        "stock": 20,
    },
    {
        "category": "Sandwiches & Toasties",
        "station": "Sandwich Station",
        "capacity": 2,
        "name": "Cheese Sandwich",
        "seed_key": "demo:cheese-sandwich",
        "description": "Development sample. Toasted cheese sandwich.",
        "price_paise": 5500,
        "prep_seconds": 360,
        "stock": 20,
    },
    {
        "category": "Rice & Noodles",
        "station": "Hot Food Station",
        "capacity": 2,
        "name": "Maggi",
        "seed_key": "demo:maggi",
        "description": "Development sample. Masala noodles.",
        "price_paise": 3500,
        "prep_seconds": 420,
        "stock": 20,
    },
    {
        "category": "Quick Bites & Snacks",
        "station": "Hot Food Station",
        "capacity": 2,
        "name": "Samosa",
        "seed_key": "demo:samosa",
        "description": "Development sample. Two potato samosas.",
        "price_paise": 2000,
        "prep_seconds": 240,
        "stock": 20,
    },
    {
        "category": "Rice & Noodles",
        "station": "Hot Food Station",
        "capacity": 2,
        "name": "Veg Fried Rice",
        "seed_key": "demo:veg-fried-rice",
        "description": "Development sample. Vegetable fried rice.",
        "price_paise": 8000,
        "prep_seconds": 600,
        "stock": 20,
    },
    {
        "category": "Beverages",
        "station": "Beverage Station",
        "capacity": 1,
        "name": "Cold Coffee",
        "seed_key": "demo:cold-coffee",
        "description": "Development sample. Chilled coffee.",
        "price_paise": 4500,
        "prep_seconds": 180,
        "stock": 20,
    },
    {
        "category": "Beverages",
        "station": "Beverage Station",
        "capacity": 1,
        "name": "Masala Chai",
        "seed_key": "demo:masala-chai",
        "description": "Development sample. Spiced tea.",
        "price_paise": 1500,
        "prep_seconds": 120,
        "stock": 20,
    },
]


def main() -> int:
    settings = get_settings()
    db = SessionLocal()
    created = 0
    skipped = 0
    try:
        college = ensure_college(db)
        canteen = db.scalar(select(Canteen).where(Canteen.slug == settings.canteen_slug))
        if canteen is None:
            canteen = Canteen(
                college_id=college.id,
                name=settings.canteen_name,
                slug=settings.canteen_slug,
            )
            db.add(canteen)
            db.flush()
        day = service_today()
        for sample in SAMPLES:
            category = db.scalar(
                select(MenuCategory).where(
                    MenuCategory.canteen_id == canteen.id,
                    MenuCategory.name == sample["category"],
                )
            )
            if category is None:
                category = MenuCategory(
                    canteen_id=canteen.id,
                    name=sample["category"],
                    sort_order=CATEGORY_ORDER.get(sample["category"], 0),
                    is_demo=True,
                )
                db.add(category)
                db.flush()
            station = db.scalar(
                select(KitchenStation).where(
                    KitchenStation.canteen_id == canteen.id,
                    KitchenStation.name == sample["station"],
                )
            )
            if station is None:
                station = KitchenStation(
                    canteen_id=canteen.id,
                    name=sample["station"],
                    parallel_capacity=sample["capacity"],
                    is_demo=True,
                )
                db.add(station)
                db.flush()
            item = db.scalar(
                select(MenuItem).where(
                    MenuItem.canteen_id == canteen.id,
                    MenuItem.seed_key == sample["seed_key"],
                )
            )
            if item is not None:
                skipped += 1
                continue
            item = MenuItem(
                canteen_id=canteen.id,
                category_id=category.id,
                name=sample["name"],
                description=sample["description"],
                price_paise=sample["price_paise"],
                prep_seconds=sample["prep_seconds"],
                is_demo=True,
                seed_key=sample["seed_key"],
            )
            db.add(item)
            db.flush()
            db.add(MenuItemStationAssignment(menu_item_id=item.id, station_id=station.id))
            stock = DailyStock(
                menu_item_id=item.id,
                service_date=day,
                available_qty=sample["stock"],
            )
            db.add(stock)
            db.flush()
            db.add(
                InventoryAdjustment(
                    daily_stock_id=stock.id,
                    menu_item_id=item.id,
                    delta_available=sample["stock"],
                    delta_reserved=0,
                    reason="demo_seed",
                )
            )
            created += 1
        db.commit()
    finally:
        db.close()
    print(f"Development menu seed finished. created={created} skipped={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
