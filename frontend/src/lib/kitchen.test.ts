import { describe, expect, it } from "vitest";

import {
  formatWait,
  sortKitchenTickets,
  startBlockReason,
  type TrackedOrder,
} from "@/lib/kitchen";

function ticket(partial: Partial<TrackedOrder> & Pick<TrackedOrder, "id" | "ticket_number">): TrackedOrder {
  return {
    status: "QUEUED",
    version: 1,
    total_paise: 1000,
    note: null,
    created_at: "2026-10-21T10:00:00.000Z",
    updated_at: "2026-10-21T10:00:00.000Z",
    accepted_at: null,
    ready_at: null,
    eta_ready_at: null,
    eta_earliest_at: null,
    eta_latest_at: null,
    eta_computed_at: null,
    eta_version: 1,
    eta_overdue: false,
    eta_blocked: false,
    payment: { method: "CASH", status: "PENDING", amount_paise: 1000 },
    items: [],
    tasks: [],
    ...partial,
  };
}

describe("kitchen helpers", () => {
  it("formats wait ages for the station board", () => {
    const now = Date.parse("2026-10-21T10:12:00.000Z");
    expect(formatWait("2026-10-21T10:11:40.000Z", now)).toBe("just now");
    expect(formatWait("2026-10-21T10:00:00.000Z", now)).toBe("12 min ago");
    expect(formatWait("2026-10-21T08:30:00.000Z", now)).toBe("1h 42m ago");
  });

  it("surfaces overdue and blocked tickets first", () => {
    const sorted = sortKitchenTickets([
      ticket({ id: "a", ticket_number: "B1", created_at: "2026-10-21T09:00:00.000Z" }),
      ticket({ id: "b", ticket_number: "B2", created_at: "2026-10-21T09:05:00.000Z", eta_blocked: true }),
      ticket({ id: "c", ticket_number: "B3", created_at: "2026-10-21T09:10:00.000Z", eta_overdue: true }),
    ]);
    expect(sorted.map((order) => order.ticket_number)).toEqual(["B3", "B2", "B1"]);
  });

  it("explains why Start cannot run when the station is full", () => {
    expect(
      startBlockReason(
        { station_id: "s1", station_name: "Fries", status: "QUEUED" },
        [
          {
            id: "s1",
            name: "Fries",
            parallel_capacity: 1,
            is_active: true,
            waiting: 1,
            in_progress: 1,
            backlog_seconds: 120,
            longest_waiting_ticket: "B1",
          },
        ],
      ),
    ).toMatch(/Fries is full/);
    expect(
      startBlockReason(
        { station_id: "s1", station_name: "Fries", status: "QUEUED" },
        [
          {
            id: "s1",
            name: "Fries",
            parallel_capacity: 2,
            is_active: true,
            waiting: 0,
            in_progress: 1,
            backlog_seconds: 0,
            longest_waiting_ticket: null,
          },
        ],
      ),
    ).toBeNull();
  });
});
