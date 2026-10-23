"use client";

import type { PointerEvent, ReactNode } from "react";

import { dishKind, DishMark } from "@/components/menu/food-mark";
import { foodImage } from "@/lib/food-art";
import { isVegetarianDish } from "@/lib/menu-diet";
import { formatInrFromPaise } from "@/lib/money";
import { nutritionLabel } from "@/lib/nutrition";
import { canOrder, stockStatusLabel, type MenuItem } from "@/lib/ordering";

const tones = ["#f6d15a", "#3df28b", "#4aa8ff", "#ff5c8a", "#f15438", "#d5f25b"];

export function categoryTone(name: string) {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return tones[hash % tones.length];
}

export function FoodPlate({ name }: { name: string }) {
  return <DishMark kind={dishKind(name)} />;
}

/** The dish picture: the canteen's photo, else a labeled illustrative image, else a drawn mark. */
export function FoodPicture({
  item,
  className,
  sizes = "small",
}: {
  item: Pick<MenuItem, "name" | "image_url">;
  className: string;
  sizes?: "small" | "large";
}) {
  const picture = foodImage(item);
  if (!picture) {
    return <FoodPlate name={item.name} />;
  }
  const src = picture.illustrative && sizes === "large" ? picture.src.replace("-sm.webp", ".webp") : picture.src;
  return (
    <>
      {/* Authenticated menu bytes are not a static public file. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={className}
        data-food-image=""
        data-illustrative={picture.illustrative ? "" : undefined}
        loading="lazy"
        decoding="async"
      />
      {picture.illustrative ? <span className="food-art-tag">Illustrative image</span> : null}
    </>
  );
}

function tilt(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") {
    return;
  }
  const node = event.currentTarget;
  const rect = node.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  node.style.setProperty("--ry", `${(x - 0.5) * 8}deg`);
  node.style.setProperty("--rx", `${(0.5 - y) * 6}deg`);
  node.style.setProperty("--gx", `${x * 100}%`);
  node.style.setProperty("--gy", `${y * 100}%`);
}

function untilt(event: PointerEvent<HTMLElement>) {
  const node = event.currentTarget;
  node.style.setProperty("--ry", "0deg");
  node.style.setProperty("--rx", "0deg");
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
      <article
      className="food-card group"
      data-unavailable={orderable ? undefined : ""}
      style={{ ["--tone" as string]: categoryTone(item.category_name) }}
      onPointerMove={tilt}
      onPointerLeave={untilt}
    >
      <button type="button" className="food-card-media" onClick={onOpen} disabled={!onOpen} aria-label={`View ${item.name}`}>
        <FoodPicture item={item} className="food-card-photo" />
        <span className="food-card-glare" aria-hidden="true" />
      </button>
      <div className="food-card-body">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 min-h-12 font-display text-2xl leading-6 font-extrabold tracking-tight break-words">
            <button type="button" className="text-left" onClick={onOpen}>
              {item.name}
            </button>
          </h3>
          <p className="food-price shrink-0">{formatInrFromPaise(item.price_paise)}</p>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{item.description || "Canteen portion."}</p>
        <div className="flex flex-wrap gap-2">
          <p className="food-flag" data-tone={isVegetarianDish(item) ? "veg" : "non-veg"}>
            {isVegetarianDish(item) ? "Veg" : "Non veg"}
          </p>
          {item.is_featured ? <p className="food-flag">{"Today's special"}</p> : null}
        </div>
        <dl className="food-facts grid gap-1">
          <div>
            <dt className="sr-only">Calories</dt>
            <dd>{nutritionLabel(item)}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Serving: </dt>
            <dd className="inline">{item.serving_size_description?.trim() || "one portion"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Prep: </dt>
            <dd className="inline">about {Math.max(1, Math.round(item.prep_seconds / 60))} min</dd>
          </div>
        </dl>
        <p className="font-mono text-[0.68rem] tracking-[0.14em] text-muted-foreground uppercase">
          {item.category_name}
          {" · "}
          {stockStatusLabel(item)}
        </p>
        <div className="mt-auto pt-1">{action}</div>
      </div>
    </article>
  );
}
