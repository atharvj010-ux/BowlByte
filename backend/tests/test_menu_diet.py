from app.services.menu_diet import infer_is_vegetarian


def test_infer_is_vegetarian_marks_common_non_veg_dishes() -> None:
    assert infer_is_vegetarian("Chicken Thali") is False
    assert infer_is_vegetarian("chicken thali") is False
    assert infer_is_vegetarian("Egg Biryani") is False
    assert infer_is_vegetarian("Fish Curry") is False
    assert infer_is_vegetarian("Non-Veg Combo") is False
    assert infer_is_vegetarian("Murgh Musallam") is False
    assert infer_is_vegetarian("Seekh Kebab") is False
    assert (
        infer_is_vegetarian(
            "Veg looking name",
            "Rice, chicken curry, dal, roti, and salad.",
        )
        is False
    )


def test_infer_is_vegetarian_keeps_veg_dishes() -> None:
    assert infer_is_vegetarian("Veg Thali") is True
    assert infer_is_vegetarian("Paneer Butter Masala") is True
    assert infer_is_vegetarian("Masala Dosa") is True
    assert infer_is_vegetarian("Vegetable Upma") is True
    assert infer_is_vegetarian("Eggplant Curry") is True
    assert infer_is_vegetarian("Meatless Burger") is True
