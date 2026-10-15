import { z } from "zod";

export const fieldClass = "min-h-11 rounded-xl border border-border bg-card px-3";

export const batchSchema = z.object({
  id: z.string(),
  batch_code: z.string(),
  menu_item_id: z.string(),
  item_name: z.string(),
  service_date: z.string(),
  service_period: z.string(),
  produced_qty: z.number().int(),
  served_counter_qty: z.number().int(),
  remaining_qty: z.number().int(),
  discarded_qty: z.number().int(),
  source: z.string(),
  equation: z.string(),
});

export const batchListSchema = z.object({
  total: z.number().int(),
  batches: z.array(batchSchema),
});

export const wasteRecordSchema = z.object({
  id: z.string(),
  item_name: z.string(),
  quantity: z.number().int(),
  reason: z.string(),
  service_date: z.string(),
  source: z.string(),
  notes: z.string(),
});

export const wasteListSchema = z.object({
  total: z.number().int(),
  records: z.array(wasteRecordSchema),
});

export const overviewSchema = z.object({
  source: z.string(),
  date_from: z.string(),
  date_to: z.string(),
  orders: z.number().int(),
  picked_up_portions: z.number().int(),
  produced_portions: z.number().int(),
  discarded_portions: z.number().int(),
  waste_ratio: z.number().nullable(),
  cash_recorded_paise: z.number().int(),
  cash_note: z.string(),
  cancelled_portions: z.number().int(),
  rejected_portions: z.number().int(),
  top_items: z.array(z.object({ name: z.string(), qty_ordered: z.number().int() })),
  active_model: z
    .object({ id: z.string(), algorithm: z.string(), source: z.string() })
    .nullable(),
  data_quality: z.object({
    observed_rows: z.number().int(),
    censored_rows: z.number().int(),
    closed_rows: z.number().int(),
  }),
  by_day: z.array(
    z.object({
      service_date: z.string(),
      ordered: z.number().int(),
      picked_up: z.number().int(),
      produced: z.number().int(),
      discarded: z.number().int(),
    }),
  ),
});

export const modelSchema = z.object({
  id: z.string(),
  algorithm: z.string(),
  status: z.string(),
  source: z.string(),
  recommended: z.boolean(),
  training_cutoff: z.string(),
  selection_reason: z.string(),
  created_at: z.string(),
  evaluations: z.array(
    z.object({
      role: z.string(),
      mae: z.number(),
      wape: z.number().nullable(),
      bias: z.number(),
      n_points: z.number().int(),
      n_days: z.number().int(),
      n_items: z.number().int(),
    }),
  ),
});

export const forecastValueSchema = z.object({
  menu_item_id: z.string(),
  service_date: z.string(),
  predicted_qty: z.number().int().nullable(),
  lower_qty: z.number().int().nullable(),
  upper_qty: z.number().int().nullable(),
  range_kind: z.string(),
  data_quality: z.string(),
  limitations: z.string(),
});

export const forecastRunSchema = z.object({
  id: z.string(),
  method: z.string(),
  source: z.string(),
  status: z.string(),
  horizon_days: z.number().int(),
  data_cutoff: z.string(),
  limitations: z.string(),
  values: z.array(forecastValueSchema).optional(),
});

export const planItemSchema = z.object({
  menu_item_id: z.string(),
  forecast_qty: z.number().int().nullable(),
  confirmed_unfulfilled_qty: z.number().int(),
  usable_prepared_qty: z.number().int(),
  scheduled_qty: z.number().int(),
  recommended_additional_qty: z.number().int(),
  feasible_qty: z.number().int(),
  unmet_qty: z.number().int(),
  capacity_limited: z.boolean(),
  explanation: z.string(),
});

export const planSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  solver: z.string(),
  simulation: z.boolean().optional(),
  label: z.string().optional(),
  items: z.array(planItemSchema),
});

export function wasteRatio(produced: number, discarded: number): number | null {
  if (produced <= 0) {
    return null;
  }
  return discarded / produced;
}

export function formatRatio(value: number | null): string {
  if (value === null) {
    return "undefined";
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "undefined";
  }
  return value.toFixed(2);
}

export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((value / max) * 100));
}

export function rangeText(kind: string, lower: number | null, upper: number | null): string {
  if (kind === "NONE" || lower === null || upper === null) {
    return "No planning range";
  }
  const label = kind === "RESIDUAL" ? "residual band" : "uncalibrated planning range";
  return `${lower}–${upper} (${label})`;
}

export function sourceBadge(source: string): { label: string; note: string } {
  if (source === "DEMO") {
    return { label: "DEMO", note: "Synthetic history. Not real canteen demand." };
  }
  if (source === "REAL") {
    return { label: "ACTUAL", note: "Recorded in this canteen." };
  }
  return { label: "UNAVAILABLE", note: "No source was recorded." };
}

export function managerCanDecide(role: string): boolean {
  return role === "CANTEEN_MANAGER";
}

export function emptyHistoryCopy(source: string): string {
  if (source === "DEMO") {
    return "No demo history is loaded. Load the labelled demo dataset before training.";
  }
  return "No recorded demand in this range. An empty day is not the same as a closed day.";
}
