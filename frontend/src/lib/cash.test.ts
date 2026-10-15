import { describe, expect, it } from "vitest";

import {
  cashSummarySchema,
  counterOrderSchema,
  credentialSchema,
  isoDate,
  newKey,
  stateBadge,
} from "@/lib/cash";

const order = {
  id: "o1",
  ticket_number: "B00042",
  status: "READY",
  version: 3,
  total_paise: 4000,
  ready_at: null,
  picked_up_at: null,
  student_first_name: "Asha",
  payment: { method: "CASH", status: "PENDING", amount_paise: 4000 },
  items: [{ item_name: "Veg Sandwich", quantity: 1 }],
} as const;

describe("state badges", () => {
  it("uses three different words for pending, paid, and picked up", () => {
    const pending = stateBadge(order);
    const paid = stateBadge({ ...order, payment: { ...order.payment, status: "PAID" } });
    const done = stateBadge({
      status: "PICKED_UP",
      payment: { ...order.payment, status: "PAID" },
    });
    expect([pending.label, paid.label, done.label]).toEqual([
      "PAYMENT PENDING",
      "PAYMENT PAID",
      "ORDER PICKED UP",
    ]);
    expect(new Set([pending.tone, paid.tone, done.tone]).size).toBe(3);
  });

  it("never shows an unpaid ready order as paid", () => {
    expect(stateBadge({ ...order, status: "READY" }).label).toBe("PAYMENT PENDING");
  });
});

describe("idempotency keys and dates", () => {
  it("creates unique keys the API will accept", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    }
  });

  it("formats UTC calendar dates", () => {
    expect(isoDate(new Date("2026-03-04T23:59:59Z"))).toBe("2026-03-04");
  });
});

describe("response schemas", () => {
  it("parses a counter order with integer paise", () => {
    expect(counterOrderSchema.parse(order).total_paise).toBe(4000);
    expect(() => counterOrderSchema.parse({ ...order, total_paise: 40.5 })).toThrow();
    expect(() =>
      counterOrderSchema.parse({ ...order, payment: { ...order.payment, method: "UPI" } }),
    ).toThrow();
  });

  it("requires the full credential shape", () => {
    expect(() => credentialSchema.parse({ token: "bbp1.x" })).toThrow();
  });

  it("keeps placed value, recorded cash, and reversals separate", () => {
    const summary = cashSummarySchema.parse({
      from_date: "2026-01-01",
      to_date: "2026-01-01",
      timezone_note: "UTC",
      orders_placed: 3,
      orders_placed_value_paise: 12000,
      paid_orders: 1,
      receipts_recorded: 2,
      gross_receipts_paise: 8000,
      reversals_recorded: 1,
      reversed_paise: 4000,
      net_cash_paise: 4000,
      ready_awaiting_payment: 1,
      ready_awaiting_payment_paise: 4000,
      paid_awaiting_pickup: 1,
      paid_awaiting_pickup_paise: 4000,
      picked_up_orders: 0,
      picked_up_value_paise: 0,
      notes: { recorded: "a", pending: "b", reconciliation: "c" },
    });
    expect(summary.net_cash_paise).toBe(summary.gross_receipts_paise - summary.reversed_paise);
    expect(summary.orders_placed_value_paise).not.toBe(summary.net_cash_paise);
  });
});
