"use client";

import type { ReactNode } from "react";

import { dishKind, DishMark } from "@/components/menu/food-mark";
import { nutritionLabel } from "@/lib/nutrition";
import { formatInrFromPaise } from "@/lib/money";
import { canOrder, type MenuItem } from "@/lib/ordering";

export function FoodPlate({ name }: { name: string }) {
  return <DishMark kind={dishKind(name)} />;
}

export function MenuCard({
  item,
  action,
  onOpen,
}: {
  item: MenuItem;
  action?: ReactNode;
  onOpen?: () => void;
}) {
  const orderable = canOrder(item);
  return (
    <article className="food-card group">
      <button type="button" className="food-card-media" onClick={onOpen} disabled={!onOpen} aria-label={`View ${item.name}`}>
        {item.image_url ? (
          // Authenticated menu bytes are not a static public file.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt="" className="food-card-photo" data-food-image="" />
        ) : (
          <FoodPlate name={item.name} />
        )}
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-2xl leading-none tracking-tight">
            <button type="button" className="text-left" onClick={onOpen}>
              {item.name}
            </button>
          </h3>
          <p className="font-display text-xl text-chili">{formatInrFromPaise(item.price_paise)}</p>
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
        <p className="text-sm">{nutritionLabel(item)}</p>
        <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
          {item.category_name}
          {orderable ? ` · ${item.available_qty} left` : " · Unavailable"}
        </p>
        {action}
      </div>
    </article>
  );
}
