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

## How the redesigned screens use it

The backend did not change in the cinematic redesign. The screens read the same fields.

- **Menu card.** It shows the nutrition line, for example “Illustrative 280 kcal / one serving”, or “Calories unavailable”. When calories are missing but a serving is recorded, it adds “Serving: …”.
- **Detail dialog.** It shows Nutrition and Prep time facts, plus a note on the source. Illustrative figures are called estimates. Verified figures name their reference.
- **Cart.** Each line shows its nutrition label. The summary adds up only known calories and says when the total is incomplete. While prices are loading, it shows a placeholder instead of a misleading 0 kcal or ₹0.00.
- **Pairings.** The heading is “Perfect together.”. Manager choices come first and the copy says “Chosen by the canteen”. The category fallback says “From the same part of the menu”. Add is a separate button for each suggestion, and nothing is added on its own. The screens never call this AI or personalization.
- **Images.** Food illustrations are labeled “Illustrative”. They show no nutrition and imply none.
