import { describe, expect, it } from "vitest";

import { nutritionLabel } from "@/lib/nutrition";

describe("nutrition labels", () => {
  it("does not invent a number", () => {
    expect(
      nutritionLabel({
        calories_kcal: null,
        nutrition_source: null,
        serving_size_description: null,
      }),
    ).toBe("Calories unavailable");
  });

  it("labels an illustrative serving", () => {
    expect(
      nutritionLabel({
        calories_kcal: 280,
        nutrition_source: "ILLUSTRATIVE",
        serving_size_description: "one serving",
      }),
    ).toBe("Illustrative 280 kcal / one serving");
  });
});
