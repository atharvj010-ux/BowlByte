"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useCart } from "@/components/cart/cart-provider";
import { FoodPairings } from "@/components/menu/food-pairings";
import { MenuCard } from "@/components/menu/menu-card";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
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
  const empty = useMemo(() => !menu.isLoading && items.length === 0, [items.length, menu.isLoading]);

  function add(itemId: string, origin: HTMLElement | null, image: string | null, name: string) {
    cart.add(itemId, origin, image, name);
    setNotice("Added to cart. The server price is confirmed at checkout.");
  }

  return (
    <section className="space-y-5" aria-labelledby="menu-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-chili uppercase">Today</p>
          <h2 id="menu-heading" className="font-display text-4xl tracking-tight">
            Menu
          </h2>
        </div>
        <label className="text-sm">
          <span className="sr-only">Search menu</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="min-h-11 w-full rounded-full border border-border bg-card px-4 sm:w-64"
          />
        </label>
      </div>
      <div className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1">
        <Button type="button" variant={categoryId ? "outline" : "default"} onClick={() => setCategoryId("")}>
          All
        </Button>
        {categories.data?.map((category) => (
          <Button
            key={category.id}
            type="button"
            variant={categoryId === category.id ? "default" : "outline"}
            onClick={() => setCategoryId(category.id)}
          >
            {category.name}
          </Button>
        ))}
      </div>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {menu.isLoading ? <p>Loading the menu.</p> : null}
      {menu.isError ? <p className="text-sm text-destructive">{menu.error.message}</p> : null}
      {empty ? <p className="text-sm text-muted-foreground">Nothing is published for that search.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <MenuCard
            key={item.id}
            item={item}
            onOpen={() => setOpenId(item.id)}
            action={
              <Button
                type="button"
                disabled={!canOrder(item)}
                onClick={(event) => {
                  const card = event.currentTarget.closest("article");
                  add(item.id, card instanceof HTMLElement ? card : null, item.image_url, item.name);
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
          onAdd={(origin) => add(open.id, origin, open.image_url, open.name)}
        />
      ) : null}
    </section>
  );
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
      <div className="food-dialog-panel">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt="" className="h-52 w-full object-cover" />
        ) : (
          <div className="food-plate food-plate-wide">
            <span>{item.name.slice(0, 1)}</span>
          </div>
        )}
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 id="food-detail-title" className="font-display text-4xl leading-none">
              {item.name}
            </h3>
            <button type="button" className="min-h-11 px-3 text-sm" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
          <p className="text-sm leading-6">{item.description}</p>
          <p className="font-display text-2xl text-chili">{formatInrFromPaise(item.price_paise)}</p>
          <p>{nutritionLabel(item)}</p>
          <p className="text-sm text-muted-foreground">
            {canOrder(item) ? `${item.available_qty} available now` : "Unavailable"}
          </p>
          <Button type="button" disabled={!canOrder(item)} onClick={(event) => onAdd(event.currentTarget)}>
            Add to cart
          </Button>
          <FoodPairings itemId={item.id} />
        </div>
      </div>
    </dialog>
  );
}
