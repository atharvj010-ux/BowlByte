import { describe, expect, it } from "vitest";

import { formatInrFromPaise } from "@/lib/money";

describe("formatInrFromPaise", () => {
  it("formats whole rupees and paise without floating point", () => {
    expect(formatInrFromPaise(0)).toBe("₹0.00");
    expect(formatInrFromPaise(4550)).toBe("₹45.50");
    expect(formatInrFromPaise(5)).toBe("₹0.05");
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatInrFromPaise(12.5)).toThrow(/integer number of paise/);
  });
});
