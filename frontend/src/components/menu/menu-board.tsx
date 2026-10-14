"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { MenuCard } from "@/components/menu/menu-card";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { menuItemSchema, saveCart, upsertLine, loadCart, canOrder } from "@/lib/ordering";

const menuResponse = z.object({
  items: z.array(menuItemSchema),
});
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
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [notice, setNotice] = useState("");
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
  const empty = useMemo(() => !menu.isLoading && items.length === 0, [items.length, menu.isLoading]);

  function add(itemId: string) {
    saveCart(upsertLine(loadCart(), itemId, 1));
    setNotice("Added to cart. The server price is confirmed at checkout.");
  }

  return (
    <section className="space-y-5" aria-labelledby="menu-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Today
          </p>
          <h2 id="menu-heading" className="font-display text-3xl">
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
      <div className="flex gap-2 overflow-x-auto pb-1">
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
      {empty ? (
        <p className="text-sm text-muted-foreground">Nothing is published for that search.</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <MenuCard
            key={item.id}
            item={item}
            action={
              <Button type="button" disabled={!canOrder(item)} onClick={() => add(item.id)}>
                {canOrder(item) ? "Add to cart" : "Unavailable"}
              </Button>
            }
          />
        ))}
      </div>
    </section>
  );
}
