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

export function formatEta(value: string | null): string {
  if (!value) {
    return "No estimate yet";
  }
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
