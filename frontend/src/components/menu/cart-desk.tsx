"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { useCart } from "@/components/cart/cart-provider";
import { FoodPairings } from "@/components/menu/food-pairings";
import { FoodPicture } from "@/components/menu/menu-card";
import { KineticText } from "@/components/motion/kinetic";
import { OrderSuccess } from "@/components/orders/order-success";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { nutritionLabel } from "@/lib/nutrition";
import {
  cartCount,
  estimateTotal,
  menuItemSchema,
  orderSchema,
  saveCart,
  upsertLine,
  type CanteenOrder,
  type MenuItem,
} from "@/lib/ordering";

const menuResponse = z.object({ items: z.array(menuItemSchema) });

export function CartDesk() {
  const router = useRouter();
  // Share lines with CartProvider so pairing "Add" (fly-to-cart) updates this page too.
  const cart = useCart();
  const lines = cart.lines;
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [key] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const [placed, setPlaced] = useState<{ order: CanteenOrder; items: MenuItem[] } | null>(null);
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

  const loading = menu.isPending;
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
  const anyIllustrative = priced.some((row) => row.item && !row.item.image_url);

  function update(id: string, quantity: number) {
    // saveCart dispatches bowlbyte-cart; CartProvider reloads lines for every listener.
    saveCart(upsertLine(lines, id, quantity));
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
      const shown = priced.flatMap((row) => (row.item ? [row.item] : []));
      saveCart([]);
      setPlaced({ order, items: shown });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order could not be placed.");
    } finally {
      setPending(false);
    }
  }

  if (placed) {
    return (
      <OrderSuccess
        order={placed.order}
        items={placed.items}
        onTrack={() => router.push(`/student/orders/${placed.order.id}`)}
        onMenu={() => router.push("/student/menu")}
      />
    );
  }

  if (cartCount(lines) === 0) {
    return (
      <section className="grid min-h-[50svh] place-content-center gap-4 text-center">
        <p className="font-display text-5xl font-extrabold tracking-tight uppercase">Your cart is empty.</p>
        <p className="text-muted-foreground">Nothing is held for you until you place an order.</p>
        <div>
          <Link href="/student/menu" className="pill pill-solid">
            Explore menu
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-label="Cart">
      <div className="space-y-2">
        <p className="eyebrow">Before the rush</p>
        <KineticText id="cart-heading" as="h2" mode="load" lines={["Cart"]} className="section-title" />
      </div>
      {menu.isError ? <p className="text-sm text-destructive">{menu.error.message}</p> : null}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="space-y-6">
          <ul className="grid gap-3">
            <AnimatePresence initial={false}>
              {priced.map(({ line, item }) => (
                <motion.li
                  key={line.menuItemId}
                  layout
                  className="cart-line"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -60, scale: 0.94, transition: { duration: 0.28 } }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                >
                  <span className="food-thumb h-20! w-20!">
                    {item ? <FoodPicture item={item} className="" /> : "?"}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-display text-xl font-bold">
                      {item?.name ??
                        (loading ? (
                          <span className="inline-block h-5 w-40 animate-pulse rounded-md bg-muted align-middle" />
                        ) : (
                          "This item is no longer listed"
                        ))}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item ? `${formatInrFromPaise(item.price_paise)} each` : loading ? "Checking price…" : "Price unavailable"}
                    </p>
                    {item ? <p className="text-xs text-muted-foreground">{nutritionLabel(item)}</p> : null}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <div className="qty">
                        <button
                          type="button"
                          aria-label={`One less ${item?.name ?? "item"}`}
                          onClick={() => update(line.menuItemId, line.quantity - 1)}
                        >
                          −
                        </button>
                        <span className="min-w-6 text-center font-semibold" aria-label={`Quantity ${line.quantity}`}>
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${item?.name ?? "item"}`}
                          onClick={() => update(line.menuItemId, line.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <button type="button" className="min-h-11 px-2 text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => update(line.menuItemId, 0)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <p className="font-display text-lg font-bold">
                    {item ? formatInrFromPaise(item.price_paise * line.quantity) : "—"}
                  </p>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {anyIllustrative ? <p className="fine">Pictures without a canteen photo are illustrative.</p> : null}
          {lines[0] ? <FoodPairings itemId={lines[0].menuItemId} heading="Complete your meal" /> : null}
        </div>

        <aside className="summary lg:sticky lg:top-24" aria-label="Order summary">
          <p className="eyebrow">Summary</p>
          {priced.map(({ line, item }) => (
            <div key={line.menuItemId} className="summary-row text-muted-foreground">
              <span className="truncate">
                {item?.name ?? (loading ? "Checking…" : "Unlisted item")} × {line.quantity}
              </span>
              <span>{item ? formatInrFromPaise(item.price_paise * line.quantity) : "—"}</span>
            </div>
          ))}
          <div className="summary-row border-t border-border pt-3">
            <span>Known calories</span>
            <span>{loading ? "—" : `${knownCalories} kcal`}</span>
          </div>
          {missingCalories && !loading ? <p className="fine">Some items have no calorie record, so this total is incomplete.</p> : null}
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm">Estimated total</span>
            <span className="font-display text-4xl font-extrabold">{loading ? "—" : formatInrFromPaise(total)}</span>
          </div>
          <p className="fine">The server confirms prices and stock when you place the order.</p>
          <p className="cash-note">Pay cash at the canteen counter.</p>
          <p className="fine">This checkout does not take payment.</p>
          <label className="block space-y-2 text-sm">
            <span className="font-medium">Note for the kitchen</span>
            <input
              value={note}
              maxLength={240}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-border bg-background px-3"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" className="min-h-13 w-full text-base" disabled={pending || menu.isLoading} onClick={place}>
            {pending ? "Placing…" : "Place order"}
          </Button>
        </aside>
      </div>
    </section>
  );
}
