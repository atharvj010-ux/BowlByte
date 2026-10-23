/** Whole-word non-veg markers — keep aligned with backend `menu_diet.NON_VEG_MARKERS`. */
const NON_VEG_MARKERS = [
  "chicken",
  "mutton",
  "egg",
  "eggs",
  "fish",
  "keema",
  "prawn",
  "prawns",
  "shrimp",
  "seafood",
  "bacon",
  "ham",
  "sausage",
  "lamb",
  "beef",
  "pork",
  "turkey",
  "duck",
  "pepperoni",
  "salami",
  "non veg",
  "non-veg",
  "nonveg",
  "meat",
  "seekh",
  "shawarma",
  "kebab",
  "kabab",
  "murgh",
  "gosht",
  "roe",
  "anchovy",
  "anchovies",
  "tuna",
  "salmon",
] as const;

const NON_VEG = new RegExp(
  `(?<![a-z])(${NON_VEG_MARKERS.map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![a-z])`,
  "i",
);

/** True when the dish text does not mention a non-veg marker. */
export function inferIsVegetarian(name: string, description = ""): boolean {
  const text = `${name} ${description}`.trim();
  if (!text) {
    return true;
  }
  return !NON_VEG.test(text);
}

/**
 * Effective veg flag for filters and badges.
 * A stored "veg" flag never wins over an obvious non-veg name/description.
 */
export function isVegetarianDish(item: {
  name: string;
  description?: string | null;
  is_vegetarian?: boolean;
}): boolean {
  if (!inferIsVegetarian(item.name, item.description ?? "")) {
    return false;
  }
  return item.is_vegetarian !== false;
}
