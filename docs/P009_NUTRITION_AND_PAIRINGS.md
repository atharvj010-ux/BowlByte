# P009 nutrition and pairings

## Nutrition

Migration `0008_nutrition_pairings` adds nullable fields on `menu_items`:

- `calories_kcal` (0–5000)
- `serving_size_description` (max 80)
- `nutrition_source` (`VERIFIED` or `ILLUSTRATIVE`)
- `nutrition_reference` (max 160)

Calories and source must be set together or cleared together. The database checks that rule. BowlByte does not invent a number from a dish name.

The menu and cart say “Calories unavailable” when either value is missing. An illustrative value is labeled, for example “Illustrative 280 kcal / one serving”. Verified values say “Verified”. The cart total of known calories says when some lines have no record. Nothing here is medical advice, and nothing is scored as healthy or unhealthy.

Managers edit the fields on the existing menu item form. Historical order prices and stock quantities are unchanged.

## Pairings

Table `menu_item_pairings` stores a canteen, a source item, a suggested item, a priority from 0 to 100, and an active flag. A row cannot point at itself. The pair is unique. Deleting a menu item deletes its pairings.

`GET /api/v1/menu/items/{id}/pairings` is student-only. It returns:

1. Active manager pairings that are in stock, same canteen, and active, ordered by priority. Basis `MANAGER`.
2. If none of those can be sold, a category fallback. Basis `CATEGORY`. A non-drink suggests items whose category name contains beverage, drink, coffee, juice, shake, cola, or soda. A drink suggests the opposite. At most four items.

Prices and stock come from the live menu row. Out-of-stock and inactive items are left out. Students cannot create pairings. Suggestions are never added unless the student taps Add.

This is not a forecasting model and it is not personalization. P006 demand forecasting is unchanged.

Fries recommending Coke works when a manager saves that pairing and Coke is available. The integration test creates that row explicitly.
