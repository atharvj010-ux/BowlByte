import { describe, expect, it } from "vitest";

import { inferIsVegetarian, isVegetarianDish } from "@/lib/menu-diet";

describe("menu diet", () => {
  it("marks chicken and egg dishes as non-veg", () => {
    expect(inferIsVegetarian("Chicken Thali")).toBe(false);
    expect(inferIsVegetarian("Egg Biryani")).toBe(false);
    expect(
      isVegetarianDish({
        name: "Chicken Thali",
        description: "Rice, chicken curry, dal, roti, and salad.",
        is_vegetarian: true,
      }),
    ).toBe(false);
  });

  it("keeps veg dishes vegetarian", () => {
    expect(inferIsVegetarian("Veg Thali")).toBe(true);
    expect(inferIsVegetarian("Eggplant Curry")).toBe(true);
    expect(isVegetarianDish({ name: "Paneer Butter Masala", is_vegetarian: true })).toBe(true);
  });
});
