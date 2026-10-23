import { describe, expect, it } from "vitest";

import { formatInrFromPaise } from "@/lib/money";
import {
  canOrder,
  cartCount,
  estimateTotal,
  menuItemFormSchema,
  rupeesToPaise,
  addToCart,
  stockLevel,
  stockStatusLabel,
  upsertLine,
} from "@/lib/ordering";

describe("money and cart", () => {
  it("formats paise without using a float total", () => {
    expect(formatInrFromPaise(4000)).toBe("₹40.00");
    expect(rupeesToPaise("40.50")).toBe(4050);
    expect(rupeesToPaise("40.5")).toBe(4050);
    expect(rupeesToPaise("40.555")).toBeNull();
  });

  it("changes quantities and totals from server prices", () => {
    const first = upsertLine([], "sandwich", 1);
    const second = upsertLine(first, "chai", 2);
    const changed = upsertLine(second, "sandwich", 3);
    expect(cartCount(changed)).toBe(5);
    expect(estimateTotal(changed, new Map([["sandwich", 4000], ["chai", 1500]]))).toBe(15000);
    expect(upsertLine(changed, "chai", 0)).toEqual([{ menuItemId: "sandwich", quantity: 3 }]);
  });

  it("adds one portion per tap and stops at twenty", () => {
    const once = addToCart([], "fries");
    const twice = addToCart(once, "fries");
    expect(twice).toEqual([{ menuItemId: "fries", quantity: 2 }]);
    expect(addToCart([{ menuItemId: "fries", quantity: 20 }], "fries")[0]?.quantity).toBe(20);
  });

  it("disables an out-of-stock item", () => {
    expect(canOrder({ is_active: true, is_available: true, available_qty: 0 })).toBe(false);
    expect(canOrder({ is_active: true, is_available: false, available_qty: 4 })).toBe(false);
    expect(canOrder({ is_active: true, is_available: true, available_qty: 1 })).toBe(true);
  });

  it("labels shelf status without exposing portion counts", () => {
    expect(stockLevel({ available_qty: 40 })).toBe("IN_STOCK");
    expect(stockLevel({ available_qty: 3 })).toBe("FEW_LEFT");
    expect(stockLevel({ available_qty: 0 })).toBe("OUT_OF_STOCK");
    expect(stockStatusLabel({ is_active: true, is_available: true, available_qty: 40 })).toBe("In stock");
    expect(stockStatusLabel({ is_active: true, is_available: true, available_qty: 2 })).toBe("Few left");
    expect(stockStatusLabel({ is_active: true, is_available: true, available_qty: 0 })).toBe("Sold out");
  });

  it("requires a category, station, and rupee price", () => {
    const missing = menuItemFormSchema.safeParse({
      name: "",
      description: "",
      price: "abc",
      prepSeconds: 10,
      categoryId: "",
      stationId: "",
    });
    expect(missing.success).toBe(false);
  });
});
