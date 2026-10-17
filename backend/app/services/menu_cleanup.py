"""Identify leftover automated-test categories without guessing at real dishes.

Playwright creates categories named like ``Snacks a1b2c3``. Those rows are
fixtures, not a second canteen menu. Demo dishes are recognized only by their
seed key, never by a fuzzy reading of the name.
"""

import re
from dataclasses import dataclass, field
from uuid import UUID

TEST_CATEGORY_NAME = re.compile(r"^(Breakfast|Drinks|Kitchen|Snacks|South) [0-9a-f]{6}$")

# seed_key -> (category name, category sort, item sort)
DEMO_PLACES: dict[str, tuple[str, int, int]] = {
    "demo:masala-dosa": ("Breakfast", 10, 10),
    "demo:samosa": ("Quick Bites & Snacks", 20, 10),
    "demo:veg-sandwich": ("Sandwiches & Toasties", 30, 10),
    "demo:cheese-sandwich": ("Sandwiches & Toasties", 30, 20),
    "demo:veg-fried-rice": ("Rice & Noodles", 40, 10),
    "demo:maggi": ("Rice & Noodles", 40, 20),
    "demo:masala-chai": ("Beverages", 50, 10),
    "demo:cold-coffee": ("Beverages", 50, 20),
}


def is_test_category_name(name: str) -> bool:
    return TEST_CATEGORY_NAME.fullmatch(name.strip()) is not None


@dataclass
class CategoryRow:
    id: UUID
    name: str
    sort_order: int
    is_active: bool
    is_demo: bool


@dataclass
class ItemRow:
    id: UUID
    name: str
    category_id: UUID
    seed_key: str | None
    is_active: bool
    sort_order: int


@dataclass
class CleanupPlan:
    archive_category_ids: list[UUID] = field(default_factory=list)
    archive_item_ids: list[UUID] = field(default_factory=list)
    category_sort: dict[UUID, int] = field(default_factory=dict)
    item_moves: dict[UUID, tuple[str, int]] = field(default_factory=dict)
    create_categories: dict[str, int] = field(default_factory=dict)
    review: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(
            self.archive_category_ids
            or self.archive_item_ids
            or self.category_sort
            or self.item_moves
            or self.create_categories
        )


def plan_cleanup(categories: list[CategoryRow], items: list[ItemRow]) -> CleanupPlan:
    """Return the soft-archive and demo-placement plan. It does not touch orders."""

    plan = CleanupPlan()
    by_id = {row.id: row for row in categories}
    items_by_category: dict[UUID, list[ItemRow]] = {}
    for item in items:
        items_by_category.setdefault(item.category_id, []).append(item)

    for category in categories:
        if is_test_category_name(category.name):
            if category.is_active:
                plan.archive_category_ids.append(category.id)
            for item in items_by_category.get(category.id, []):
                if item.is_active:
                    plan.archive_item_ids.append(item.id)

    needed: dict[str, int] = {}
    for item in items:
        place = DEMO_PLACES.get(item.seed_key or "")
        if place is None:
            continue
        category_name, category_sort, item_sort = place
        needed[category_name] = category_sort
        current = by_id.get(item.category_id)
        if current is None or current.name != category_name or item.sort_order != item_sort:
            plan.item_moves[item.id] = (category_name, item_sort)

    existing_names = {row.name: row for row in categories}
    for name, sort_order in needed.items():
        current = existing_names.get(name)
        if current is None:
            plan.create_categories[name] = sort_order
        elif current.sort_order != sort_order or not current.is_active:
            plan.category_sort[current.id] = sort_order

    moved_away = {item_id for item_id in plan.item_moves}
    for category in categories:
        if is_test_category_name(category.name) or category.name not in {"Snacks", "Main Course"}:
            continue
        remaining = [
            item
            for item in items_by_category.get(category.id, [])
            if item.is_active and item.id not in moved_away and item.id not in plan.archive_item_ids
        ]
        if remaining:
            names = ", ".join(item.name for item in remaining)
            plan.review.append(
                f"{category.name} still has dishes that were not part of the demo seed: {names}"
            )
            continue
        if category.is_active:
            plan.archive_category_ids.append(category.id)
    return plan
