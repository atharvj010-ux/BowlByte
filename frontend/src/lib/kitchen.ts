import { z } from "zod";

import { orderItemSchema } from "@/lib/ordering";

const payment = z.object({
  method: z.literal("CASH"),
  status: z.enum(["PENDING", "PAID", "VOIDED"]),
  amount_paise: z.number().int(),
  paid_at: z.string().nullable().optional(),
});

export const taskSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  order_item_id: z.string(),
  station_id: z.string(),
  station_name: z.string(),
  item_name: z.string(),
  unit_index: z.number().int(),
  status: z.string(),
  expected_duration_seconds: z.number().int(),
  extra_delay_seconds: z.number().int(),
  delay_reason: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export const trackedOrderSchema = z.object({
  id: z.string(),
  ticket_number: z.string(),
  status: z.string(),
  version: z.number().int(),
  total_paise: z.number().int(),
  note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  accepted_at: z.string().nullable(),
  ready_at: z.string().nullable(),
  eta_ready_at: z.string().nullable(),
  eta_earliest_at: z.string().nullable(),
  eta_latest_at: z.string().nullable(),
  eta_computed_at: z.string().nullable(),
  eta_version: z.number().int(),
  eta_overdue: z.boolean(),
  eta_blocked: z.boolean(),
  picked_up_at: z.string().nullable().optional(),
  payment,
  items: z.array(orderItemSchema),
  tasks: z.array(taskSchema),
});

export const stationWorkloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  parallel_capacity: z.number().int(),
  is_active: z.boolean(),
  waiting: z.number().int(),
  in_progress: z.number().int(),
  backlog_seconds: z.number().int(),
  longest_waiting_ticket: z.string().nullable(),
});

export const queueSchema = z.object({
  orders: z.array(trackedOrderSchema),
  stations: z.array(stationWorkloadSchema),
});

export const overviewSchema = z.object({
  placed: z.number().int(),
  waiting: z.number().int(),
  preparing: z.number().int(),
  ready: z.number().int(),
  active_orders: z.number().int(),
  average_observed_prep_seconds: z.number().int().nullable(),
  average_queue_wait_seconds: z.number().int().nullable(),
  delayed_orders: z.number().int(),
  stations: z.array(stationWorkloadSchema),
  notes: z.object({
    observed: z.string(),
    estimated: z.string(),
    cash_collected: z.string(),
  }),
});

export type TrackedOrder = z.infer<typeof trackedOrderSchema>;
export type StationWorkload = z.infer<typeof stationWorkloadSchema>;
export type KitchenTask = z.infer<typeof taskSchema>;

export function formatEta(value: string | null): string {
  if (!value) {
    return "No estimate yet";
  }
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Why Start is blocked before the staff even taps — capacity or paused station. */
export function startBlockReason(
  task: Pick<KitchenTask, "station_id" | "station_name" | "status">,
  stations: StationWorkload[],
): string | null {
  if (task.status !== "QUEUED") {
    return null;
  }
  const station = stations.find((row) => row.id === task.station_id);
  if (!station) {
    return null;
  }
  if (!station.is_active) {
    return `${station.name} is paused. A manager must reopen it.`;
  }
  if (station.in_progress >= station.parallel_capacity) {
    return `${station.name} is full (${station.in_progress}/${station.parallel_capacity}). Complete a line there first, then Start.`;
  }
  return null;
}

/** Human wait age for kitchen tickets ("just now", "4 min", "1h 12m"). */
export function formatWait(fromIso: string | null | undefined, nowMs = Date.now()): string {
  if (!fromIso) {
    return "—";
  }
  const mins = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 60_000));
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins} min ago`;
  }
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

/** Overdue and blocked tickets surface first so nothing sits unnoticed. */
export function sortKitchenTickets(orders: TrackedOrder[]): TrackedOrder[] {
  return [...orders].sort((left, right) => {
    const leftScore = (left.eta_overdue ? 2 : 0) + (left.eta_blocked ? 1 : 0);
    const rightScore = (right.eta_overdue ? 2 : 0) + (right.eta_blocked ? 1 : 0);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}
