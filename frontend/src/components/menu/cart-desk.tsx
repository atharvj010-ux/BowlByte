"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { FoodPairings } from "@/components/menu/food-pairings";
import { OrderSuccess } from "@/components/orders/order-success";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { nutritionLabel } from "@/lib/nutrition";
import {
  cartCount,
  estimateTotal,
  loadCart,
  menuItemSchema,
  orderSchema,
  saveCart,
  upsertLine,
  type CanteenOrder,
  type CartLine,
} from "@/lib/ordering";
import { useRouter } from "next/navigation";

const menuResponse = z.object({ items: z.array(menuItemSchema) });

export function CartDesk() {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>(() => loadCart());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [key] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const [placed, setPlaced] = useState<CanteenOrder | null>(null);
  const menu = useQuery({
    queryKey: ["menu", "checkout", lines.map((line) => line.menuItemId).join(",")],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/menu/items?limit=50");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const listed = menuResponse.parse(await response.json());
      const found = new Set(listed.items.map((item) => item.id));
      const missing = lines.filter((line) => !found.has(line.menuItemId));
      const extras = await Promise.all(
        missing.map(async (line) => {
          const one = await apiFetch(`/api/v1/menu/items/${line.menuItemId}`);
          if (!one.ok) {
            return null;
          }
          return menuItemSchema.parse(await one.json());
        }),
      );
      return { items: [...listed.items, ...extras.filter((item) => item !== null)] };
    },
  });

  const priced = useMemo(() => {
    const byId = new Map((menu.data?.items ?? []).map((item) => [item.id, item]));
    return lines.map((line) => ({ line, item: byId.get(line.menuItemId) ?? null }));
  }, [lines, menu.data]);
  const prices = new Map(
    priced.filter((row) => row.item).map((row) => [row.line.menuItemId, row.item!.price_paise]),
  );
  const total = estimateTotal(lines, prices);
  const knownCalories = priced.reduce((sum, row) => {
    if (!row.item || row.item.calories_kcal == null || row.item.nutrition_source == null) {
      return sum;
    }
    return sum + row.item.calories_kcal * row.line.quantity;
  }, 0);
  const missingCalories = priced.some(
    (row) => !row.item || row.item.calories_kcal == null || row.item.nutrition_source == null,
  );

  function update(id: string, quantity: number) {
    const next = upsertLine(lines, id, quantity);
    setLines(next);
    saveCart(next);
  }

  async function place() {
    setError("");
    setPending(true);
    try {
      const response = await apiFetch("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify({
          items: lines.map((line) => ({ menu_item_id: line.menuItemId, quantity: line.quantity })),
          note: note.trim() || null,
          idempotency_key: key,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const order = orderSchema.parse(await response.json());
      saveCart([]);
      setLines([]);
      setPlaced(order);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order could not be placed.");
    } finally {
      setPending(false);
    }
  }

  if (placed) {
    return (
      <OrderSuccess
        order={placed}
        onTrack={() => router.push(`/student/orders/${placed.id}`)}
        onMenu={() => router.push("/student/menu")}
      />
    );
  }

  if (cartCount(lines) === 0) {
    return <p className="text-sm text-muted-foreground">Your cart is empty.</p>;
  }

  return (
    <section className="space-y-5" aria-labelledby="cart-heading">
      <h2 id="cart-heading" className="font-display text-4xl tracking-tight">
        Cart
      </h2>
      {menu.isError ? <p className="text-sm text-destructive">{menu.error.message}</p> : null}
      <ul className="grid gap-3">
        {priced.map(({ line, item }) => (
          <li key={line.menuItemId} className="flex gap-3 rounded-2xl border border-border bg-card p-4">
            <span className="food-thumb">{item?.name.slice(0, 1) ?? "?"}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{item?.name ?? "This item is no longer listed"}</p>
              <p className="text-sm text-muted-foreground">
                {item ? formatInrFromPaise(item.price_paise) : "Price unavailable"}
              </p>
              {item ? <p className="text-xs text-muted-foreground">{nutritionLabel(item)}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => update(line.menuItemId, line.quantity - 1)}>
                Less
              </Button>
              <span aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
              <Button type="button" variant="outline" onClick={() => update(line.menuItemId, line.quantity + 1)}>
                More
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {lines[0] ? <FoodPairings itemId={lines[0].menuItemId} heading="Make it a combo." /> : null}
      <label className="block space-y-2 text-sm">
        <span className="font-medium">Note</span>
        <input
          value={note}
          maxLength={240}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-11 w-full rounded-xl border border-border bg-card px-3"
        />
      </label>
      <p className="font-display text-2xl">Estimated total {formatInrFromPaise(total)}</p>
      <p className="text-sm text-muted-foreground">
        {missingCalories
          ? `Known calories ${knownCalories} kcal. Some items have no calorie record.`
          : `Known calories ${knownCalories} kcal.`}
      </p>
      <p className="text-sm">Pay cash when collecting your food. This checkout does not take payment.</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" disabled={pending || menu.isLoading} onClick={place}>
        {pending ? "Placing…" : "Place order"}
      </Button>
    </section>
  );
}
