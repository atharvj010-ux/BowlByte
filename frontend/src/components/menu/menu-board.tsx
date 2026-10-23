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
import { groupInMenuOrder, type MenuSort } from "@/lib/menu-order";
import { isVegetarianDish } from "@/lib/menu-diet";
import { canOrder, menuItemSchema, stockStatusLabel, type MenuItem } from "@/lib/ordering";

const menuResponse = z.object({ items: z.array(menuItemSchema), total: z.number() });
const categoriesResponse = z.array(z.object({ id: z.string(), name: z.string(), sort_order: z.number() }));

async function loadMenu(query: string, categoryId: string, sort: MenuSort) {
  const params = new URLSearchParams({ limit: "50", sort });
  if (query) {
    params.set("q", query);
  }
  if (categoryId === "featured") {
    params.set("featured", "true");
  } else if (categoryId) {
    params.set("category_id", categoryId);
  }
  let response: Response;
  try {
    response = await apiFetch(`/api/v1/menu/items?${params.toString()}`);
  } catch {
    throw new Error("Menu could not be loaded. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const page = menuResponse.parse(await response.json());
  const items = [...page.items];
  // Cap follow-up pages so a large catalog cannot exhaust the Vercel proxy budget.
  while (items.length < page.total && items.length < 200) {
    params.set("offset", String(items.length));
    let next: Response;
    try {
      next = await apiFetch(`/api/v1/menu/items?${params.toString()}`);
    } catch {
      break;
    }
    if (!next.ok) {
      break;
    }
    const more = menuResponse.parse(await next.json());
    if (more.items.length === 0) {
      break;
    }
    items.push(...more.items);
  }
  return { items, total: page.total };
}

type StockFilter = "" | "in_stock" | "sold_out";
type DietFilter = "" | "veg" | "non_veg";

function matchesMenuFilters(item: MenuItem, stockFilter: StockFilter, dietFilter: DietFilter): boolean {
  if (stockFilter === "in_stock" && !canOrder(item)) {
    return false;
  }
  if (stockFilter === "sold_out" && canOrder(item)) {
    return false;
  }
  const vegetarian = isVegetarianDish(item);
  if (dietFilter === "veg" && !vegetarian) {
    return false;
  }
  if (dietFilter === "non_veg" && vegetarian) {
    return false;
  }
  return true;
}

export function MenuBoard() {
  const cart = useCart();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<MenuSort>("recommended");
  const [stockFilter, setStockFilter] = useState<StockFilter>("");
  const [dietFilter, setDietFilter] = useState<DietFilter>("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [suggestId, setSuggestId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const categories = useQuery({
    queryKey: ["menu-categories"],
    queryFn: async () => {
      let response: Response;
      try {
        response = await apiFetch("/api/v1/menu/categories");
      } catch {
        throw new Error("Categories could not be loaded. Try again.");
      }
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return categoriesResponse.parse(await response.json());
    },
  });
  const menu = useQuery({
    queryKey: ["menu", query, categoryId, sort],
    queryFn: () => loadMenu(query, categoryId, sort),
  });
  const specials = useQuery({
    queryKey: ["menu-specials"],
    queryFn: () => loadMenu("", "featured", "recommended"),
  });
  const items = (menu.data?.items ?? []).filter((item) =>
    matchesMenuFilters(item, stockFilter, dietFilter),
  );
  const open = items.find((item) => item.id === openId) ?? null;
  const empty = !menu.isLoading && !menu.isError && items.length === 0;
  const grouped = sort === "recommended" && categoryId === "" && !query && !stockFilter && !dietFilter;
  const sections = grouped ? groupInMenuOrder(items) : [{ id: "results", name: "", items }];

  function add(itemId: string, origin: HTMLElement | null, image: string | null, name: string) {
    cart.add(itemId, origin, image, name);
    setSuggestId(itemId);
    setNotice("Added to cart. The server price is confirmed at checkout.");
  }

  return (
    <section className="space-y-6" aria-label="Menu">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="eyebrow">Today at the counter</p>
          <KineticText id="menu-heading" as="h2" mode="load" lines={["Menu"]} className="section-title" />
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="relative text-sm">
            <span className="sr-only">Search menu</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search"
              className="min-h-12 w-full rounded-full border border-border bg-card px-5 sm:w-64"
            />
          </label>
          {draft ? (
            <button type="button" className="chip-btn" onClick={() => setDraft("")}>
              Clear search
            </button>
          ) : null}
          <label className="text-sm">
            <span className="sr-only">Sort menu</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as MenuSort)}
              className="min-h-12 w-full rounded-full border border-border bg-card px-4 sm:w-52"
              data-testid="menu-sort"
            >
              <option value="recommended">Recommended</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="name">Name: A to Z</option>
            </select>
          </label>
        </div>
      </div>
      <div className="menu-filters" role="group" aria-label="Filters" data-testid="menu-filters">
        <button
          type="button"
          className="chip-btn"
          aria-pressed={stockFilter === "in_stock"}
          data-testid="filter-in-stock"
          onClick={() => setStockFilter((current) => (current === "in_stock" ? "" : "in_stock"))}
        >
          In stock
        </button>
        <button
          type="button"
          className="chip-btn"
          aria-pressed={stockFilter === "sold_out"}
          data-testid="filter-sold-out"
          onClick={() => setStockFilter((current) => (current === "sold_out" ? "" : "sold_out"))}
        >
          Sold out
        </button>
        <button
          type="button"
          className="chip-btn"
          aria-pressed={dietFilter === "veg"}
          data-testid="filter-veg"
          onClick={() => setDietFilter((current) => (current === "veg" ? "" : "veg"))}
        >
          Veg
        </button>
        <button
          type="button"
          className="chip-btn"
          aria-pressed={dietFilter === "non_veg"}
          data-testid="filter-non-veg"
          onClick={() => setDietFilter((current) => (current === "non_veg" ? "" : "non_veg"))}
        >
          Non veg
        </button>
        {stockFilter || dietFilter ? (
          <button
            type="button"
            className="chip-btn"
            data-testid="filter-clear"
            onClick={() => {
              setStockFilter("");
              setDietFilter("");
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <div className="menu-cats" role="group" aria-label="Categories" data-testid="menu-categories">
        <button type="button" className="chip-btn" aria-pressed={categoryId === ""} onClick={() => setCategoryId("")}>
          All items
        </button>
        {(specials.data?.total ?? 0) > 0 ? (
          <button
            type="button"
            className="chip-btn"
            aria-pressed={categoryId === "featured"}
            onClick={() => setCategoryId("featured")}
          >
            {"Today's Specials"}
          </button>
        ) : null}
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
      {suggestId ? <FoodPairings itemId={suggestId} heading="Complete your meal" /> : null}
      {menu.isLoading ? (
        <div className="food-grid" aria-label="Loading the menu">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-96 animate-pulse rounded-[1.6rem] bg-card" />
          ))}
        </div>
      ) : null}
      {menu.isError ? <p className="text-sm text-destructive">{menu.error.message}</p> : null}
      {empty ? (
        <p className="text-sm text-muted-foreground">
          {stockFilter || dietFilter || query
            ? "Nothing matches those filters. Clear search or filters to see more items."
            : "Nothing matches that search. Clear it to see the menu again."}
        </p>
      ) : null}
      {!empty
        ? sections.map((section) => (
        <section key={section.id} className="space-y-4">
          {section.name ? (
            <h3 className="font-display text-3xl font-extrabold tracking-tight uppercase">{section.name}</h3>
          ) : null}
          <div className="food-grid">
            {section.items.map((item) => (
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
                    {canOrder(item) ? "Add to cart" : "Sold out"}
                  </Button>
                }
              />
            ))}
          </div>
        </section>
      ))
        : null}
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
            <p className="food-flag" data-tone={isVegetarianDish(item) ? "veg" : "non-veg"}>
              {isVegetarianDish(item) ? "Veg" : "Non veg"}
            </p>
            <p className="text-sm text-muted-foreground">{stockStatusLabel(item)}</p>
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
            {canOrder(item) ? "Add to cart" : "Sold out"}
          </Button>
          <FoodPairings itemId={item.id} heading="Complete your meal" />
        </div>
      </div>
    </dialog>
  );
}
