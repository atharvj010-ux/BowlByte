import { z } from "zod";

export const menuItemSchema = z.object({
  id: z.string(),
  category_id: z.string(),
  category_name: z.string(),
  station_id: z.string().nullable(),
  station_name: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  price_paise: z.number().int(),
  prep_seconds: z.number().int(),
  is_active: z.boolean(),
  is_available: z.boolean(),
  is_demo: z.boolean(),
  calories_kcal: z.number().int().nullable(),
  serving_size_description: z.string().nullable(),
  nutrition_source: z.enum(["VERIFIED", "ILLUSTRATIVE"]).nullable(),
  nutrition_reference: z.string().nullable(),
  image_url: z.string().nullable(),
  available_qty: z.number().int(),
  reserved_qty: z.number().int().nullable().optional(),
});

export type MenuItem = z.infer<typeof menuItemSchema>;

export const orderItemSchema = z.object({
  menu_item_id: z.string(),
  item_name: z.string(),
  unit_price_paise: z.number().int(),
  quantity: z.number().int(),
  line_total_paise: z.number().int(),
  station_name: z.string().nullable(),
  prep_seconds: z.number().int(),
});

export const orderSchema = z.object({
  id: z.string(),
  ticket_number: z.string(),
  status: z.string(),
  total_paise: z.number().int(),
  note: z.string().nullable(),
  created_at: z.string(),
  payment: z.object({
    method: z.literal("CASH"),
    status: z.enum(["PENDING", "PAID", "VOIDED"]),
    amount_paise: z.number().int(),
  }),
  items: z.array(orderItemSchema),
  student_name: z.string().nullable().optional(),
});

export type CanteenOrder = z.infer<typeof orderSchema>;

export type CartLine = { menuItemId: string; quantity: number };

const CART_KEY = "bowlbyte.cart.v1";

export function rupeesToPaise(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [rupees, fraction = ""] = trimmed.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isInteger(paise)) {
    return null;
  }
  return paise;
}

export function upsertLine(lines: CartLine[], menuItemId: string, quantity: number): CartLine[] {
  if (quantity <= 0) {
    return lines.filter((line) => line.menuItemId !== menuItemId);
  }
  const next = Math.min(quantity, 20);
  const existing = lines.find((line) => line.menuItemId === menuItemId);
  if (!existing) {
    return [...lines, { menuItemId, quantity: next }];
  }
  return lines.map((line) => (line.menuItemId === menuItemId ? { ...line, quantity: next } : line));
}

export function addToCart(lines: CartLine[], menuItemId: string, step = 1): CartLine[] {
  const existing = lines.find((line) => line.menuItemId === menuItemId);
  const next = Math.min((existing?.quantity ?? 0) + step, 20);
  return upsertLine(lines, menuItemId, next);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function estimateTotal(
  lines: CartLine[],
  prices: ReadonlyMap<string, number>,
): number {
  return lines.reduce((sum, line) => sum + (prices.get(line.menuItemId) ?? 0) * line.quantity, 0);
}

export function loadCart(): CartLine[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = z.array(z.object({ menuItemId: z.string(), quantity: z.number().int() })).parse(
      JSON.parse(window.localStorage.getItem(CART_KEY) ?? "[]"),
    );
    return parsed.filter((line) => line.quantity > 0 && line.quantity <= 20);
  } catch {
    return [];
  }
}

export function saveCart(lines: CartLine[]): void {
  window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event("bowlbyte-cart"));
}

export const menuItemFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  description: z.string().trim().max(400),
  price: z.string().trim().refine((value) => rupeesToPaise(value) !== null, "Enter a rupee price."),
  prepSeconds: z.coerce.number().int().min(30, "Use at least 30 seconds.").max(7200),
  categoryId: z.string().min(1, "Choose a category."),
  stationId: z.string().min(1, "Choose a station."),
});

export function canOrder(item: Pick<MenuItem, "is_active" | "is_available" | "available_qty">): boolean {
  return item.is_active && item.is_available && item.available_qty > 0;
}
