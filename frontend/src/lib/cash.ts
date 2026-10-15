import { z } from "zod";

const payment = z.object({
  method: z.literal("CASH"),
  status: z.enum(["PENDING", "PAID", "VOIDED"]),
  amount_paise: z.number().int(),
  paid_at: z.string().nullable().optional(),
  receipt_ref: z.string().nullable().optional(),
});

export const counterOrderSchema = z.object({
  id: z.string(),
  ticket_number: z.string(),
  status: z.string(),
  version: z.number().int(),
  total_paise: z.number().int(),
  ready_at: z.string().nullable(),
  picked_up_at: z.string().nullable(),
  student_first_name: z.string().nullable(),
  payment,
  items: z.array(z.object({ item_name: z.string(), quantity: z.number().int() })),
});

export const cashierBoardSchema = z.object({
  awaiting_payment: z.array(counterOrderSchema),
  awaiting_handover: z.array(counterOrderSchema),
  overdue: z.array(counterOrderSchema).default([]),
  completed: z.array(counterOrderSchema),
  totals: z.object({
    awaiting_payment_paise: z.number().int(),
    recorded_today_paise: z.number().int(),
    window_note: z.string(),
  }),
});

export const reversalSchema = z.object({
  id: z.string(),
  amount_paise: z.number().int(),
  kind: z.string(),
  reason: z.string(),
  reversed_at: z.string(),
  manager_name: z.string().nullable(),
});

export const receiptSchema = z.object({
  id: z.string(),
  receipt_no: z.number().int(),
  receipt_ref: z.string(),
  order_id: z.string(),
  ticket_number: z.string(),
  amount_paise: z.number().int(),
  cashier_user_id: z.string(),
  cashier_name: z.string().nullable(),
  received_at: z.string(),
  reversed: z.boolean(),
  reversal: reversalSchema.nullable(),
});

export const historySchema = z.object({
  transactions: z.array(receiptSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const verifySchema = z.object({
  order: counterOrderSchema,
  credential_id: z.string(),
  credential_expires_at: z.string(),
  can_confirm_cash: z.boolean(),
  can_complete_pickup: z.boolean(),
});

export const confirmCashSchema = z.object({
  receipt: receiptSchema,
  order: counterOrderSchema,
  replayed: z.boolean(),
});

export const completePickupSchema = z.object({
  order: counterOrderSchema,
  replayed: z.boolean(),
});

export const reverseSchema = z.object({ receipt: receiptSchema, replayed: z.boolean() });

export const cashSummarySchema = z.object({
  from_date: z.string(),
  to_date: z.string(),
  timezone_note: z.string(),
  orders_placed: z.number().int(),
  orders_placed_value_paise: z.number().int(),
  paid_orders: z.number().int(),
  receipts_recorded: z.number().int(),
  gross_receipts_paise: z.number().int(),
  reversals_recorded: z.number().int(),
  reversed_paise: z.number().int(),
  net_cash_paise: z.number().int(),
  ready_awaiting_payment: z.number().int(),
  ready_awaiting_payment_paise: z.number().int(),
  paid_awaiting_pickup: z.number().int(),
  paid_awaiting_pickup_paise: z.number().int(),
  picked_up_orders: z.number().int(),
  picked_up_value_paise: z.number().int(),
  notes: z.object({
    recorded: z.string(),
    pending: z.string(),
    reconciliation: z.string(),
  }),
});

export const credentialSchema = z.object({
  credential_id: z.string(),
  order_id: z.string(),
  ticket_number: z.string(),
  token: z.string(),
  code: z.string(),
  issued_at: z.string(),
  expires_at: z.string(),
  replaced_previous: z.boolean(),
});

export const pickupStatusSchema = z.object({
  order_id: z.string(),
  order_status: z.string(),
  state: z.enum(["NOT_READY", "AVAILABLE", "ACTIVE", "EXPIRED", "COLLECTED"]),
  can_request: z.boolean(),
  credential_expires_at: z.string().nullable(),
  payment_status: z.string(),
  paid_at: z.string().nullable(),
  picked_up_at: z.string().nullable(),
});

export const notificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  order_id: z.string().nullable(),
  created_at: z.string(),
  read_at: z.string().nullable(),
  read: z.boolean(),
});

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread_count: z.number().int(),
});

export type CounterOrder = z.infer<typeof counterOrderSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Credential = z.infer<typeof credentialSchema>;

export type PaymentBadge = { label: string; tone: "pending" | "paid" | "done" };

/** The three states are always shown with distinct words, never colour alone. */
export function stateBadge(order: Pick<CounterOrder, "status" | "payment">): PaymentBadge {
  if (order.status === "PICKED_UP") {
    return { label: "ORDER PICKED UP", tone: "done" };
  }
  if (order.payment.status === "PAID") {
    return { label: "PAYMENT PAID", tone: "paid" };
  }
  return { label: "PAYMENT PENDING", tone: "pending" };
}

export function newKey(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
