import { describe, expect, it } from "vitest";

import {
  barPercent,
  emptyHistoryCopy,
  formatMetric,
  formatRatio,
  managerCanDecide,
  rangeText,
  sourceBadge,
  wasteRatio,
} from "@/lib/intelligence";

describe("intelligence display", () => {
  it("leaves waste percentage undefined when nothing was produced", () => {
    expect(wasteRatio(0, 0)).toBeNull();
    expect(formatRatio(null)).toBe("undefined");
    expect(formatRatio(wasteRatio(12, 2))).toBe("16.7%");
  });

  it("prints an undefined WAPE instead of zero", () => {
    expect(formatMetric(null)).toBe("undefined");
    expect(formatMetric(0)).toBe("0.00");
    expect(formatMetric(1.234)).toBe("1.23");
  });

  it("labels residual and uncalibrated ranges differently", () => {
    expect(rangeText("RESIDUAL", 8, 12)).toContain("residual band");
    expect(rangeText("UNCALIBRATED", 8, 12)).toContain("uncalibrated");
    expect(rangeText("NONE", null, null)).toBe("No planning range");
  });

  it("keeps demo history distinct from recorded demand", () => {
    expect(sourceBadge("DEMO").label).toBe("DEMO");
    expect(sourceBadge("REAL").note).toContain("Recorded");
    expect(emptyHistoryCopy("DEMO")).toContain("demo");
    expect(emptyHistoryCopy("REAL")).toContain("closed");
  });

  it("scales bars from the largest value and blocks non-managers", () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(3, 0)).toBe(0);
    expect(managerCanDecide("CANTEEN_MANAGER")).toBe(true);
    expect(managerCanDecide("CASHIER")).toBe(false);
    expect(managerCanDecide("KITCHEN_STAFF")).toBe(false);
    expect(managerCanDecide("STUDENT")).toBe(false);
  });
});
