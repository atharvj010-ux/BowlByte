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
    expect(foodArt("Cold Coffee").dish).toBe("cold-coffee");
    expect(foodArt("Filter Coffee").dish).toBe("chai");
  });

  it("maps listed dishes to the matching food photo", () => {
    expect(foodImage({ name: "Paneer Paratha", image_url: null })).toEqual({
      src: "/food/paratha-sm.webp",
      illustrative: true,
    });
    expect(foodImage({ name: "Gobi Paratha", image_url: null })?.src).toBe("/food/paratha-sm.webp");
    expect(foodImage({ name: "Poha", image_url: null })?.src).toBe("/food/poha-sm.webp");
    expect(foodImage({ name: "Vegetable Upma", image_url: null })?.src).toBe("/food/upma-sm.webp");
    expect(foodImage({ name: "Medu Vada", image_url: null })?.src).toBe("/food/medu-vada-sm.webp");
    expect(foodImage({ name: "Onion Uttapam", image_url: null })?.src).toBe("/food/uttapam-sm.webp");
    expect(foodImage({ name: "Paneer Butter Masala", image_url: null })?.src).toBe(
      "/food/paneer-curry-sm.webp",
    );
    expect(foodImage({ name: "Mango Shake", image_url: null })?.src).toBe("/food/shake-sm.webp");
    expect(foodImage({ name: "Mango Lassi", image_url: null })?.src).toBe("/food/lassi-sm.webp");
    expect(foodImage({ name: "Orange Juice", image_url: null })?.src).toBe("/food/juice-sm.webp");
    expect(foodImage({ name: "Veg Thali", image_url: null })?.src).toBe("/food/thali-sm.webp");
    expect(foodImage({ name: "Chicken Biryani", image_url: null })?.src).toBe("/food/biryani-sm.webp");
    expect(foodImage({ name: "Chicken Roll", image_url: null })?.src).toBe("/food/roll-sm.webp");
    expect(foodImage({ name: "Egg Roll", image_url: null })?.src).toBe("/food/roll-sm.webp");
    expect(foodImage({ name: "Paneer Roll", image_url: null })?.src).toBe("/food/roll-sm.webp");
    expect(foodImage({ name: "Chicken Wrap", image_url: null })?.src).toBe("/food/wrap-sm.webp");
    expect(foodImage({ name: "Veg Wrap", image_url: null })?.src).toBe("/food/wrap-sm.webp");
    expect(foodImage({ name: "Grilled Chicken", image_url: null })?.src).toBe(
      "/food/grilled-chicken-sm.webp",
    );
  });
});
