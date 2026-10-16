from app.core.errors import ApiError
from app.models.ordering import MenuItem
from app.services.pairings import apply_nutrition


def test_calories_without_a_source_are_rejected() -> None:
    item = MenuItem(
        canteen_id="00000000-0000-0000-0000-000000000001",
        category_id="00000000-0000-0000-0000-000000000002",
        name="Plate",
        description="",
        price_paise=100,
        prep_seconds=60,
    )
    try:
        apply_nutrition(item, {"calories_kcal": 200})
    except ApiError as error:
        assert error.status_code == 422
    else:
        raise AssertionError("calories were stored without a source")
    assert item.calories_kcal is None


def test_clearing_calories_removes_the_source() -> None:
    item = MenuItem(
        canteen_id="00000000-0000-0000-0000-000000000001",
        category_id="00000000-0000-0000-0000-000000000002",
        name="Plate",
        description="",
        price_paise=100,
        prep_seconds=60,
        calories_kcal=10,
        nutrition_source="ILLUSTRATIVE",
    )
    apply_nutrition(item, {"calories_kcal": None, "nutrition_source": None})
    assert item.calories_kcal is None
    assert item.nutrition_source is None
