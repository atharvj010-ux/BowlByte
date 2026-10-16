import { describe, expect, it } from "vitest";

import { foodArt, foodImage } from "@/lib/food-art";

describe("food imagery", () => {
  it("prefers the canteen's own photo", () => {
    expect(foodImage({ name: "Masala Dosa", image_url: "/api/v1/menu/items/1/image" })).toEqual({
      src: "/api/v1/menu/items/1/image",
      illustrative: false,
    });
  });

  it("falls back to a labeled illustrative image by dish name", () => {
    expect(foodImage({ name: "Masala Dosa 4f65a9", image_url: null })).toEqual({
      src: "/food/dosa-sm.webp",
      illustrative: true,
    });
    expect(foodArt("Cold Coffee")?.dish).toBe("cold-coffee");
    expect(foodArt("Filter Coffee")?.dish).toBe("chai");
  });

  it("returns nothing for a dish it cannot illustrate", () => {
    expect(foodImage({ name: "Paneer Tikka", image_url: null })).toBeNull();
  });
});
