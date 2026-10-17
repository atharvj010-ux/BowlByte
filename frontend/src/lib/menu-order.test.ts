import { describe, expect, it } from "vitest";

import { groupInMenuOrder } from "@/lib/menu-order";
import type { MenuItem } from "@/lib/ordering";

function item(id: string, categoryId: string, category: string): MenuItem {
  return {
    id,
    category_id: categoryId,
    category_name: category,
    station_id: null,
    station_name: null,
    name: id,
    description: "",
    price_paise: 100,
    prep_seconds: 60,
    is_active: true,
    is_available: true,
    is_demo: false,
    calories_kcal: null,
    serving_size_description: null,
    nutrition_source: null,
    nutrition_reference: null,
    image_url: null,
    available_qty: 1,
    sort_order: 0,
    is_featured: false,
    category_sort_order: 0,
  };
}

describe("groupInMenuOrder", () => {
  it("keeps the server order and starts a heading when the category changes", () => {
    const groups = groupInMenuOrder([
      item("dosa", "breakfast", "Breakfast"),
      item("samosa", "snacks", "Quick Bites & Snacks"),
      item("chai", "drinks", "Beverages"),
      item("coffee", "drinks", "Beverages"),
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      "Breakfast",
      "Quick Bites & Snacks",
      "Beverages",
    ]);
    expect(groups[2]?.items.map((entry) => entry.id)).toEqual(["chai", "coffee"]);
  });
});
