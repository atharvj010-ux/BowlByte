from uuid import uuid4

from app.services.menu_cleanup import CategoryRow, ItemRow, is_test_category_name, plan_cleanup


def test_hex_suffix_categories_are_fixtures() -> None:
    assert is_test_category_name("Snacks a1b2c3")
    assert is_test_category_name("Kitchen fea1b2")
    assert not is_test_category_name("Snacks")
    assert not is_test_category_name("Beverages")
    assert not is_test_category_name("South Indian")


def test_plan_archives_fixtures_and_places_demo_dishes_by_seed_key() -> None:
    snacks = uuid4()
    drinks = uuid4()
    breakfast = uuid4()
    dosa = uuid4()
    sandwich = uuid4()
    coke = uuid4()
    plan = plan_cleanup(
        [
            CategoryRow(snacks, "Snacks", 0, True, True),
            CategoryRow(drinks, "Drinks a1b2c3", 0, True, False),
            CategoryRow(breakfast, "Breakfast", 0, True, True),
        ],
        [
            ItemRow(dosa, "Masala Dosa", breakfast, "demo:masala-dosa", True, 0),
            ItemRow(sandwich, "Veg Sandwich", snacks, "demo:veg-sandwich", True, 0),
            ItemRow(coke, "Coke a1b2c3", drinks, None, True, 0),
        ],
    )
    assert drinks in plan.archive_category_ids
    assert coke in plan.archive_item_ids
    assert snacks in plan.archive_category_ids
    assert sandwich not in plan.archive_item_ids
    assert plan.item_moves[sandwich][0] == "Sandwiches & Toasties"
    assert plan.item_moves[dosa][0] == "Breakfast"
    assert "Sandwiches & Toasties" in plan.create_categories
    assert plan.review == []


def test_plan_flags_an_unknown_dish_instead_of_hiding_its_category() -> None:
    snacks = uuid4()
    extra = uuid4()
    plan = plan_cleanup(
        [CategoryRow(snacks, "Snacks", 0, True, False)],
        [ItemRow(extra, "Manager Special Thali", snacks, None, True, 0)],
    )
    assert snacks not in plan.archive_category_ids
    assert plan.review
