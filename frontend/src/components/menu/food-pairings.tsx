"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useCart } from "@/components/cart/cart-provider";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { nutritionLabel } from "@/lib/nutrition";
import { canOrder, menuItemSchema, type MenuItem } from "@/lib/ordering";

const pairingSchema = z.object({
  basis: z.enum(["MANAGER", "CATEGORY"]),
  items: z.array(menuItemSchema),
});

export function FoodPairings({ itemId, heading = "Perfect together." }: { itemId: string; heading?: string }) {
  const cart = useCart();
  const pairings = useQuery({
    queryKey: ["pairings", itemId],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/menu/items/${itemId}/pairings`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return pairingSchema.parse(await response.json());
    },
  });
  const items = pairings.data?.items ?? [];
  if (pairings.isLoading || items.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3" aria-label={heading} data-testid="pairings">
      <div>
        <h3 className="font-display text-2xl">{heading}</h3>
        <p className="text-sm text-muted-foreground">
          {pairings.data?.basis === "MANAGER"
            ? "Chosen by the canteen. Nothing is added unless you tap it."
            : "A category suggestion from what is in stock. Nothing is added unless you tap it."}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
            <PairThumb item={item} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.name}</p>
              <p className="text-sm text-chili">{formatInrFromPaise(item.price_paise)}</p>
              <p className="text-xs text-muted-foreground">{nutritionLabel(item)}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!canOrder(item)}
              onClick={(event) => cart.add(item.id, event.currentTarget, item.image_url, item.name)}
            >
              Add
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PairThumb({ item }: { item: MenuItem }) {
  if (!item.image_url) {
    return <span className="food-thumb">{item.name.slice(0, 1)}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.image_url} alt="" className="food-thumb object-cover" />
  );
}
