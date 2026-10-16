"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useCart } from "@/components/cart/cart-provider";
import { FoodPairings } from "@/components/menu/food-pairings";
import { categoryTone, FoodPicture, MenuCard } from "@/components/menu/menu-card";
import { KineticText } from "@/components/motion/kinetic";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { foodImage } from "@/lib/food-art";
import { formatInrFromPaise } from "@/lib/money";
import { nutritionLabel } from "@/lib/nutrition";
import { canOrder, menuItemSchema, type MenuItem } from "@/lib/ordering";

const menuResponse = z.object({ items: z.array(menuItemSchema) });
const categoriesResponse = z.array(z.object({ id: z.string(), name: z.string() }));

async function loadMenu(query: string, categoryId: string) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (categoryId) {
    params.set("category_id", categoryId);
  }
  const response = await apiFetch(`/api/v1/menu/items?${params.toString()}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return menuResponse.parse(await response.json());
}

export function MenuBoard() {
  const cart = useCart();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const categories = useQuery({
    queryKey: ["menu-categories"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/menu/categories");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return categoriesResponse.parse(await response.json());
    },
  });
  const menu = useQuery({
    queryKey: ["menu", query, categoryId],
    queryFn: () => loadMenu(query, categoryId),
  });
  const items = menu.data?.items ?? [];
  const open = items.find((item) => item.id === openId) ?? null;
  const empty = !menu.isLoading && !menu.isError && items.length === 0;

  function add(itemId: string, origin: HTMLElement | null, image: string | null, name: string) {
    cart.add(itemId, origin, image, name);
    setNotice("Added to cart. The server price is confirmed at checkout.");
  }

  return (
    <section className="space-y-6" aria-label="Menu">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="eyebrow">Today at the counter</p>
          <KineticText id="menu-heading" as="h2" mode="load" lines={["Menu"]} className="section-title" />
        </div>
        <label className="text-sm">
          <span className="sr-only">Search menu</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="min-h-12 w-full rounded-full border border-border bg-card px-5 lg:w-72"
          />
        </label>
      </div>
      <div className="flex w-full max-w-full min-w-0 gap-2 overflow-x-auto pb-1" role="group" aria-label="Categories">
        <button type="button" className="chip-btn" aria-pressed={categoryId === ""} onClick={() => setCategoryId("")}>
          All
        </button>
        {categories.data?.map((category) => (
          <button
            key={category.id}
            type="button"
            className="chip-btn"
            aria-pressed={categoryId === category.id}
            onClick={() => setCategoryId(category.id)}
          >
            {category.name}
          </button>
        ))}
      </div>
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {menu.isLoading ? (
        <div className="food-grid" aria-label="Loading the menu">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-96 animate-pulse rounded-[1.6rem] bg-card" />
          ))}
        </div>
      ) : null}
      {menu.isError ? <p className="text-sm text-destructive">{menu.error.message}</p> : null}
      {empty ? <p className="text-sm text-muted-foreground">Nothing is published for that search.</p> : null}
      <div className="food-grid">
        {items.map((item) => (
          <MenuCard
            key={item.id}
            item={item}
            onOpen={() => setOpenId(item.id)}
            action={
              <Button
                type="button"
                className="w-full"
                disabled={!canOrder(item)}
                onClick={(event) => {
                  const card = event.currentTarget.closest("article");
                  add(item.id, card instanceof HTMLElement ? card : null, flightImage(item), item.name);
                }}
              >
                {canOrder(item) ? "Add to cart" : "Unavailable"}
              </Button>
            }
          />
        ))}
      </div>
      {open ? (
        <FoodDetail
          item={open}
          onClose={() => setOpenId(null)}
          onAdd={(origin) => add(open.id, origin, flightImage(open), open.name)}
        />
      ) : null}
    </section>
  );
}

export function flightImage(item: Pick<MenuItem, "name" | "image_url">) {
  return foodImage(item)?.src ?? null;
}

function FoodDetail({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (origin: HTMLElement | null) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) {
      return;
    }
    if (!node.open) {
      node.showModal();
    }
    return () => {
      if (node.open) {
        node.close();
      }
    };
  }, []);

  const minutes = Math.max(1, Math.round(item.prep_seconds / 60));
  return (
    <dialog
      ref={dialogRef}
      className="food-dialog"
      aria-labelledby="food-detail-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="food-dialog-panel" style={{ ["--tone" as string]: categoryTone(item.category_name) }}>
        <div className="food-dialog-media" ref={mediaRef}>
          <FoodPicture item={item} className="" sizes="large" />
        </div>
        <div className="space-y-5 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{item.category_name}</p>
              <h3 id="food-detail-title" className="mt-2 font-display text-4xl leading-[0.9] font-extrabold tracking-tight uppercase">
                {item.name}
              </h3>
            </div>
            <button type="button" className="chip-btn" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
          {item.description ? <p className="leading-7 text-ivory/80">{item.description}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <p className="food-price text-2xl">{formatInrFromPaise(item.price_paise)}</p>
            <p className="text-sm text-muted-foreground">
              {canOrder(item) ? `${item.available_qty} available now` : "Unavailable"}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-white/5 p-3">
              <dt className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">Nutrition</dt>
              <dd className="mt-1">{nutritionLabel(item)}</dd>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <dt className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">Prep time</dt>
              <dd className="mt-1">About {minutes} min per portion</dd>
            </div>
          </dl>
          {item.nutrition_source ? (
            <p className="fine">
              {item.nutrition_source === "ILLUSTRATIVE"
                ? "Illustrative figure: an estimate, not a lab measurement."
                : "Verified figure recorded by the canteen."}
              {item.nutrition_reference ? ` ${item.nutrition_reference}` : ""}
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={!canOrder(item)}
            onClick={() => onAdd(mediaRef.current)}
          >
            Add to cart
          </Button>
          <FoodPairings itemId={item.id} />
        </div>
      </div>
    </dialog>
  );
}
