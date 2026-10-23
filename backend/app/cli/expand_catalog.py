"""Add breakfast, lunch, and beverage dishes, then fill missing calorie labels.

New rows use a seed key, so running this again does not duplicate them.
Calorie figures are illustrative estimates, never marked verified.
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
    MenuItemPairing,
    MenuItemStationAssignment,
)
from app.services.identity import ensure_college
from app.services.ordering import service_today

REFERENCE = "Illustrative canteen-portion estimate. Not a laboratory measurement."

BREAKFAST = [
    ("Poha", "Flattened rice with onion, peanut, and lemon.", 40, 280, "one plate", 360),
    (
        "Vegetable Upma",
        "Semolina cooked with vegetables and curry leaves.",
        40,
        310,
        "one plate",
        420,
    ),
    ("Medu Vada", "Two lentil doughnuts with coconut chutney.", 35, 260, "two pieces", 420),
    ("Rava Dosa", "Crisp semolina crepe with potato masala.", 70, 390, "one dosa", 480),
    ("Onion Uttapam", "Thick rice pancake topped with onion.", 60, 340, "one uttapam", 480),
    ("Set Dosa", "Three soft dosas with sambar and chutney.", 70, 420, "three dosas", 540),
    ("Idli Sambar", "Four steamed rice cakes with lentil sambar.", 50, 300, "four idlis", 420),
    ("Mini Idli", "Ten mini idlis in a bowl of sambar.", 55, 320, "one bowl", 420),
    ("Aloo Paratha", "Wheat flatbread stuffed with spiced potato.", 60, 410, "two parathas", 540),
    (
        "Paneer Paratha",
        "Wheat flatbread stuffed with cottage cheese.",
        80,
        460,
        "two parathas",
        540,
    ),
    ("Gobi Paratha", "Wheat flatbread stuffed with cauliflower.", 65, 400, "two parathas", 540),
    ("Methi Paratha", "Fenugreek flatbread with pickle.", 50, 360, "two parathas", 480),
    ("Plain Paratha", "Layered wheat flatbread with curd.", 40, 330, "two parathas", 420),
    ("Egg Bhurji", "Scrambled eggs with onion, tomato, and chilli.", 60, 290, "one plate", 360),
    ("Masala Omelette", "Two-egg omelette with onion and coriander.", 50, 240, "one omelette", 300),
    ("Bread Omelette", "Omelette folded in two slices of bread.", 55, 340, "one sandwich", 360),
    ("Boiled Eggs", "Two boiled eggs with salt and pepper.", 30, 160, "two eggs", 480),
    ("Puri Bhaji", "Four fried breads with potato curry.", 55, 480, "one plate", 480),
    ("Chole Bhature", "Spiced chickpeas with two fried breads.", 80, 620, "one plate", 540),
    ("Misal Pav", "Sprouted moth curry with two bread rolls.", 70, 450, "one bowl", 420),
    ("Sabudana Khichdi", "Tapioca pearls with peanut and potato.", 55, 360, "one plate", 420),
    ("Vermicelli Upma", "Roasted vermicelli with vegetables.", 45, 300, "one plate", 360),
    ("Rava Idli", "Four semolina cakes with chutney.", 50, 280, "four pieces", 420),
    ("Paniyaram", "Eight savoury rice dumplings.", 55, 310, "eight pieces", 480),
    ("Neer Dosa", "Two thin rice crepes with chutney.", 50, 240, "two dosas", 420),
    ("Cheese Omelette", "Two-egg omelette with melted cheese.", 70, 340, "one omelette", 360),
    ("French Toast", "Two egg-dipped toast slices.", 50, 320, "two slices", 300),
    ("Banana Pancake", "Two banana pancakes with honey.", 70, 380, "two pancakes", 420),
    ("Veg Cutlet", "Two vegetable cutlets with chutney.", 40, 260, "two pieces", 420),
    ("Aloo Tikki", "Two potato patties with chutney.", 35, 280, "two pieces", 360),
    ("Sprouts Bowl", "Steamed sprouts with onion and lemon.", 45, 180, "one bowl", 240),
    ("Fruit Bowl", "Seasonal chopped fruit.", 50, 140, "one bowl", 180),
    ("Cornflakes Milk", "Cornflakes with chilled milk.", 40, 220, "one bowl", 120),
    ("Oats Porridge", "Milk oats with banana.", 45, 250, "one bowl", 300),
    ("Moong Chilla", "Two yellow-lentil pancakes.", 50, 240, "two pieces", 420),
    ("Besan Chilla", "Two gram-flour pancakes with onion.", 45, 260, "two pieces", 420),
    ("Akki Roti", "Two rice-flour flatbreads with chutney.", 50, 340, "two rotis", 480),
    ("Thatte Idli", "Two plate idlis with sambar.", 55, 330, "two idlis", 480),
    ("Bisi Bele Bath", "Rice and lentil porridge with vegetables.", 60, 380, "one plate", 480),
    ("Lemon Rice", "Rice tossed with lemon, peanut, and curry leaf.", 50, 340, "one plate", 360),
    ("Tomato Rice", "Rice cooked with tomato and spices.", 50, 350, "one plate", 420),
    ("Grilled Cheese Toast", "Two slices with melted cheese.", 55, 360, "two slices", 300),
    ("Peanut Butter Toast", "Two slices with peanut butter.", 40, 320, "two slices", 180),
    ("Banana Toast", "Two slices with banana and honey.", 40, 280, "two slices", 180),
    ("Egg Toast", "Two slices topped with fried egg.", 55, 340, "two slices", 360),
    ("Paneer Bhurji", "Scrambled cottage cheese with pepper.", 80, 360, "one plate", 420),
    ("Mushroom Omelette", "Two-egg omelette with mushroom.", 70, 280, "one omelette", 420),
    ("Veg Breakfast Burrito", "Wheat roll with potato and beans.", 75, 430, "one roll", 420),
    ("Yogurt Parfait", "Curd layered with fruit and granola.", 60, 240, "one cup", 180),
    ("Masala Oats", "Savoury oats with vegetables.", 45, 270, "one bowl", 360),
]

LUNCH = [
    ("Veg Thali", "Rice, dal, two vegetables, roti, and curd.", 90, 680, "one thali", 600),
    ("Chicken Thali", "Rice, chicken curry, dal, roti, and salad.", 140, 780, "one thali", 720),
    (
        "Paneer Butter Masala",
        "Cottage cheese in tomato gravy, with rice.",
        120,
        620,
        "one plate",
        600,
    ),
    ("Dal Tadka", "Tempered yellow lentils with jeera rice.", 80, 480, "one plate", 480),
    ("Jeera Rice", "Cumin rice with raita.", 60, 380, "one plate", 360),
    ("Veg Biryani", "Spiced vegetable rice with raita.", 100, 560, "one plate", 720),
    ("Chicken Biryani", "Spiced chicken rice with raita.", 140, 690, "one plate", 780),
    ("Egg Biryani", "Spiced egg rice with raita.", 110, 610, "one plate", 720),
    ("Rajma Chawal", "Kidney-bean curry with rice.", 80, 520, "one plate", 540),
    ("Chole Rice", "Chickpea curry with rice.", 80, 540, "one plate", 540),
    ("Palak Paneer", "Spinach and cottage cheese with two rotis.", 110, 500, "one plate", 600),
    ("Kadai Paneer", "Pepper cottage cheese with two rotis.", 120, 540, "one plate", 600),
    ("Matar Paneer", "Pea and cottage cheese curry with rice.", 110, 530, "one plate", 600),
    ("Mix Vegetable", "Seasonal vegetables with two rotis.", 80, 420, "one plate", 540),
    ("Aloo Gobi", "Potato and cauliflower with two rotis.", 75, 400, "one plate", 540),
    ("Bhindi Masala", "Okra curry with two rotis.", 75, 360, "one plate", 540),
    ("Dal Fry", "Fried lentils with jeera rice.", 70, 450, "one plate", 480),
    ("Curd Rice", "Rice mixed with curd and tempering.", 50, 320, "one plate", 240),
    ("Veg Pulao", "Vegetable rice with raita.", 80, 460, "one plate", 540),
    ("Peas Pulao", "Pea rice with raita.", 75, 440, "one plate", 480),
    ("Veg Fried Rice", "Stir-fried rice with vegetables.", 80, 480, "one plate", 480),
    ("Schezwan Rice", "Spicy rice with vegetables.", 90, 520, "one plate", 540),
    ("Hakka Noodles", "Stir-fried noodles with vegetables.", 80, 470, "one plate", 480),
    ("Veg Manchurian", "Vegetable dumplings in gravy, with rice.", 90, 510, "one plate", 540),
    ("Chilli Paneer", "Cottage cheese in chilli sauce, with rice.", 120, 560, "one plate", 540),
    ("Paneer Tikka", "Grilled cottage cheese with mint chutney.", 130, 420, "eight pieces", 600),
    ("Chicken Curry Rice", "Home-style chicken curry with rice.", 130, 640, "one plate", 720),
    ("Butter Chicken Rice", "Tomato chicken gravy with rice.", 150, 720, "one plate", 720),
    ("Egg Curry Rice", "Boiled eggs in gravy with rice.", 90, 540, "one plate", 540),
    ("Fish Curry Rice", "Coastal fish curry with rice.", 140, 520, "one plate", 600),
    ("Roti Basket", "Four wheat rotis with pickle.", 30, 280, "four rotis", 360),
    ("Butter Naan", "Two naan breads brushed with butter.", 50, 360, "two naan", 420),
    ("Garlic Naan", "Two garlic naan breads.", 60, 380, "two naan", 420),
    ("Tandoori Roti", "Two whole-wheat tandoor rotis.", 30, 220, "two rotis", 360),
    ("Pav Bhaji", "Vegetable mash with two buttered rolls.", 80, 520, "one plate", 480),
    ("Vada Pav", "Potato fritter in a bread roll.", 30, 290, "one piece", 300),
    ("Paneer Roll", "Cottage cheese roll with onion.", 80, 430, "one roll", 420),
    ("Chicken Roll", "Spiced chicken roll.", 90, 460, "one roll", 480),
    ("Egg Roll", "Egg and onion roll.", 60, 380, "one roll", 420),
    ("Veg Burger", "Vegetable patty burger.", 70, 410, "one burger", 420),
    ("Cheese Burger", "Vegetable patty with cheese.", 85, 480, "one burger", 480),
    ("Red Sauce Pasta", "Penne in tomato sauce.", 90, 490, "one plate", 540),
    ("White Sauce Pasta", "Penne in cream sauce.", 100, 560, "one plate", 540),
    ("Mac and Cheese", "Macaroni in cheese sauce.", 90, 540, "one bowl", 480),
    ("Veg Thai Curry", "Coconut vegetable curry with rice.", 110, 520, "one plate", 600),
    ("Grilled Chicken", "Grilled chicken breast with salad.", 150, 380, "one plate", 720),
    ("Garden Salad", "Lettuce, cucumber, tomato, and lemon.", 60, 120, "one bowl", 180),
    ("Paneer Salad", "Cottage cheese cubes on greens.", 90, 280, "one bowl", 240),
    ("Veg Wrap", "Wheat wrap with beans and salad.", 70, 390, "one wrap", 360),
    ("Chicken Wrap", "Wheat wrap with grilled chicken.", 100, 430, "one wrap", 420),
]

BEVERAGES = [
    ("Filter Coffee", "South Indian filter coffee with milk.", 25, 80, "one tumbler", 180),
    ("Black Coffee", "Brewed coffee without milk.", 30, 5, "one cup", 180),
    ("Cappuccino", "Espresso with steamed milk foam.", 60, 120, "one cup", 240),
    ("Cafe Latte", "Espresso with steamed milk.", 60, 140, "one cup", 240),
    ("Mocha", "Coffee with cocoa and milk.", 70, 220, "one cup", 240),
    ("Iced Americano", "Chilled espresso and water.", 50, 15, "one glass", 180),
    ("Hot Chocolate", "Cocoa with hot milk.", 50, 240, "one cup", 240),
    ("Badam Milk", "Warm milk with almond.", 40, 180, "one glass", 300),
    ("Turmeric Milk", "Warm milk with turmeric.", 35, 150, "one glass", 300),
    ("Rose Milk", "Chilled milk with rose syrup.", 40, 190, "one glass", 180),
    ("Buttermilk", "Spiced churned curd.", 20, 60, "one glass", 120),
    ("Sweet Lassi", "Sweet blended curd.", 35, 180, "one glass", 180),
    ("Salt Lassi", "Salted blended curd.", 30, 140, "one glass", 180),
    ("Mango Lassi", "Curd blended with mango.", 50, 220, "one glass", 180),
    ("Banana Shake", "Milk blended with banana.", 45, 230, "one glass", 180),
    ("Chocolate Shake", "Milk blended with cocoa.", 55, 280, "one glass", 240),
    ("Strawberry Shake", "Milk blended with strawberry.", 55, 250, "one glass", 240),
    ("Vanilla Shake", "Milk blended with vanilla.", 50, 240, "one glass", 180),
    ("Mango Shake", "Milk blended with mango.", 55, 260, "one glass", 180),
    ("Cold Cocoa", "Chilled cocoa milk.", 40, 200, "one glass", 180),
    ("Lemonade", "Lemon, water, and sugar.", 25, 90, "one glass", 120),
    ("Mint Lime", "Lime soda with mint.", 30, 80, "one glass", 180),
    ("Orange Juice", "Fresh orange juice.", 50, 110, "one glass", 180),
    ("Apple Juice", "Chilled apple juice.", 45, 120, "one glass", 120),
    ("Watermelon Juice", "Fresh watermelon juice.", 40, 80, "one glass", 180),
    ("Pineapple Juice", "Fresh pineapple juice.", 45, 130, "one glass", 180),
    ("Mixed Fruit Juice", "Blend of seasonal fruit.", 50, 140, "one glass", 240),
    ("Sugarcane Juice", "Pressed sugarcane.", 30, 180, "one glass", 180),
    ("Coconut Water", "Tender coconut water.", 40, 45, "one glass", 60),
    ("Masala Soda", "Sparkling water with masala.", 25, 40, "one glass", 120),
    ("Cola", "Chilled cola.", 30, 140, "one can", 60),
    ("Lemon Soda", "Soda with lemon.", 25, 50, "one glass", 120),
    ("Jeera Soda", "Cumin sparkling water.", 25, 40, "one glass", 120),
    ("Green Tea", "Steeped green tea.", 20, 2, "one cup", 240),
    ("Lemon Tea", "Black tea with lemon.", 20, 30, "one cup", 240),
    ("Ginger Tea", "Black tea with ginger.", 20, 40, "one cup", 300),
    ("Black Tea", "Tea without milk.", 15, 2, "one cup", 240),
    ("Iced Tea", "Chilled black tea with lemon.", 35, 70, "one glass", 180),
    ("Peach Iced Tea", "Chilled tea with peach.", 40, 90, "one glass", 180),
    ("Virgin Mojito", "Lime, mint, and soda.", 50, 80, "one glass", 240),
    ("Kokum Cooler", "Kokum syrup with water.", 30, 90, "one glass", 120),
    ("Jaljeera", "Cumin lemonade.", 25, 50, "one glass", 120),
    ("Aam Panna", "Raw mango cooler.", 30, 100, "one glass", 180),
    ("Thandai", "Chilled milk with nuts and spice.", 50, 210, "one glass", 180),
    ("Protein Shake", "Milk with protein powder.", 80, 220, "one glass", 180),
    ("Electrolyte Drink", "Salt and citrus water.", 30, 40, "one bottle", 60),
    ("Sparkling Water", "Plain sparkling water.", 25, 0, "one bottle", 30),
    ("Iced Latte", "Chilled coffee with milk.", 60, 150, "one glass", 240),
    ("Masala Buttermilk", "Buttermilk with ginger and curry leaf.", 25, 70, "one glass", 120),
    ("Date Shake", "Milk blended with dates.", 55, 270, "one glass", 240),
]


def _category(db, canteen_id, name: str, sort_order: int) -> MenuCategory:
    row = db.scalar(
        select(MenuCategory).where(MenuCategory.canteen_id == canteen_id, MenuCategory.name == name)
    )
    if row is None:
        row = MenuCategory(canteen_id=canteen_id, name=name, sort_order=sort_order, is_demo=False)
        db.add(row)
        db.flush()
    return row


def _station(db, canteen_id, name: str) -> KitchenStation:
    row = db.scalar(
        select(KitchenStation).where(
            KitchenStation.canteen_id == canteen_id, KitchenStation.name == name
        )
    )
    if row is None:
        row = KitchenStation(canteen_id=canteen_id, name=name, parallel_capacity=2, is_demo=False)
        db.add(row)
        db.flush()
    return row


def _estimate(category_name: str) -> tuple[int, str]:
    lowered = category_name.lower()
    if "beverage" in lowered or "drink" in lowered:
        return 120, "one glass"
    if "breakfast" in lowered:
        return 320, "one plate"
    if "lunch" in lowered or "rice" in lowered or "noodle" in lowered:
        return 520, "one plate"
    if "sandwich" in lowered:
        return 380, "one sandwich"
    return 280, "one portion"


def main() -> int:
    if not (len(BREAKFAST) == len(LUNCH) == len(BEVERAGES) == 50):
        print("Catalog lists must contain 50 dishes each.")
        return 2
    settings = get_settings()
    db = SessionLocal()
    created = 0
    skipped = 0
    labeled = 0
    linked = 0
    try:
        college = ensure_college(db)
        canteen = db.scalar(select(Canteen).where(Canteen.slug == settings.canteen_slug))
        if canteen is None:
            canteen = Canteen(
                college_id=college.id, name=settings.canteen_name, slug=settings.canteen_slug
            )
            db.add(canteen)
            db.flush()
        day = service_today()
        groups = [
            ("Breakfast", 10, "Hot Food Station", "breakfast", BREAKFAST),
            ("Lunch", 15, "Hot Food Station", "lunch", LUNCH),
            ("Beverages", 50, "Beverage Station", "beverage", BEVERAGES),
        ]
        made: dict[str, list[MenuItem]] = {"breakfast": [], "lunch": [], "beverage": []}
        for category_name, sort_order, station_name, kind, rows in groups:
            category = _category(db, canteen.id, category_name, sort_order)
            station = _station(db, canteen.id, station_name)
            for index, (name, description, rupees, kcal, serving, prep) in enumerate(rows, start=1):
                seed_key = f"catalog:{kind}:{index:02d}"
                item = db.scalar(
                    select(MenuItem).where(
                        MenuItem.canteen_id == canteen.id, MenuItem.seed_key == seed_key
                    )
                )
                from app.services.menu_diet import infer_is_vegetarian

                vegetarian = infer_is_vegetarian(name, description)
                if item is None:
                    item = MenuItem(
                        canteen_id=canteen.id,
                        category_id=category.id,
                        name=name,
                        description=description,
                        price_paise=rupees * 100,
                        prep_seconds=prep,
                        sort_order=index,
                        is_active=True,
                        is_available=True,
                        is_vegetarian=vegetarian,
                        is_demo=False,
                        calories_kcal=kcal,
                        serving_size_description=serving,
                        nutrition_source="ILLUSTRATIVE",
                        nutrition_reference=REFERENCE,
                        seed_key=seed_key,
                    )
                    db.add(item)
                    db.flush()
                    db.add(MenuItemStationAssignment(menu_item_id=item.id, station_id=station.id))
                    stock = DailyStock(menu_item_id=item.id, service_date=day, available_qty=15)
                    db.add(stock)
                    db.flush()
                    db.add(
                        InventoryAdjustment(
                            daily_stock_id=stock.id,
                            menu_item_id=item.id,
                            delta_available=15,
                            delta_reserved=0,
                            reason="catalog_expansion",
                        )
                    )
                    created += 1
                else:
                    if item.is_vegetarian != vegetarian:
                        item.is_vegetarian = vegetarian
                    skipped += 1
                made[kind].append(item)
        drinks = made["beverage"]
        meals = made["breakfast"] + made["lunch"]
        catalog_ids = [item.id for item in meals + drinks]
        removed = db.scalars(
            select(MenuItemPairing).where(MenuItemPairing.source_item_id.in_(catalog_ids))
        )
        for row in list(removed):
            db.delete(row)
        db.flush()
        for index, meal in enumerate(meals):
            for drink in (drinks[index % len(drinks)], drinks[(index + 17) % len(drinks)]):
                db.add(
                    MenuItemPairing(
                        canteen_id=canteen.id,
                        source_item_id=meal.id,
                        suggested_item_id=drink.id,
                        priority=20,
                    )
                )
                linked += 1
        for index, drink in enumerate(drinks):
            for meal in (meals[index % len(meals)], meals[(index + 23) % len(meals)]):
                db.add(
                    MenuItemPairing(
                        canteen_id=canteen.id,
                        source_item_id=drink.id,
                        suggested_item_id=meal.id,
                        priority=20,
                    )
                )
                linked += 1
        existing = list(db.scalars(select(MenuItem).where(MenuItem.canteen_id == canteen.id)))
        categories = {
            row.id: row.name
            for row in db.scalars(select(MenuCategory).where(MenuCategory.canteen_id == canteen.id))
        }
        for item in existing:
            if item.calories_kcal is not None:
                continue
            kcal, serving = _estimate(categories.get(item.category_id, ""))
            item.calories_kcal = kcal
            item.serving_size_description = item.serving_size_description or serving
            item.nutrition_source = "ILLUSTRATIVE"
            item.nutrition_reference = REFERENCE
            if not (item.description or "").strip():
                item.description = "Canteen portion served at the counter."
            labeled += 1
        db.commit()
    finally:
        db.close()
    print(
        f"Catalog expansion finished. created={created} skipped={skipped} "
        f"labeled={labeled} pairings={linked}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
