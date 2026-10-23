"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useCart } from "@/components/cart/cart-provider";
import { FoodPicture } from "@/components/menu/menu-card";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { foodImage } from "@/lib/food-art";
import { formatInrFromPaise } from "@/lib/money";
import { nutritionLabel } from "@/lib/nutrition";
import { canOrder, menuItemSchema } from "@/lib/ordering";

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
        <h3 className="font-display text-3xl leading-none font-extrabold tracking-tight uppercase">{heading}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {pairings.data?.basis === "MANAGER"
            ? "Chosen to finish the meal. Nothing is added unless you tap it."
            : "A drink with food, or food with a drink, from what is in stock. Nothing is added unless you tap it."}
          {items.some((item) => !item.image_url) ? " Pictures without a canteen photo are illustrative." : ""}
        </p>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-[1.25rem] border border-border bg-white/[0.03] p-2.5 pr-3"
          >
            <span className="food-thumb">
              <FoodPicture item={item} className="" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{item.name}</p>
              <p className="text-sm text-[#ff8a70]">{formatInrFromPaise(item.price_paise)}</p>
              <p className="text-xs text-muted-foreground">{nutritionLabel(item)}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canOrder(item)}
              onClick={(event) =>
                cart.add(item.id, event.currentTarget.closest("li"), foodImage(item)?.src ?? null, item.name)
              }
            >
              Add
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
