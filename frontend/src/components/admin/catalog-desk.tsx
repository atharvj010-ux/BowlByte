"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { EmptyState, Notice, Panel, Segmented, SkeletonLines, StatGrid, StatTile } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import {
  menuItemFormSchema,
  menuItemSchema,
  rupeesToPaise,
  STOCK_LEVEL_QTY,
  stockLevel,
  type StockLevel,
} from "@/lib/ordering";
import { cn } from "@/lib/utils";

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  sort_order: z.number(),
  is_active: z.boolean().default(true),
});
const stationSchema = z.object({
  id: z.string(),
  name: z.string(),
  parallel_capacity: z.number(),
  is_active: z.boolean(),
  is_demo: z.boolean(),
});
const menuListSchema = z.object({ items: z.array(menuItemSchema) });

async function readJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Stock data could not be read. Refresh the page, or restart the API if this keeps happening.");
  }
  return parsed.data;
}

function shelfLabel(item: { is_available: boolean; available_qty: number }): {
  label: string;
  tone: "is-good" | "is-warn" | "is-bad" | "";
} {
  if (!item.is_available) {
    return { label: "Unlisted", tone: "" };
  }
  if (item.available_qty <= 0) {
    return { label: "Out of stock", tone: "is-bad" };
  }
  if (item.available_qty <= 5) {
    return { label: "Few left", tone: "is-warn" };
  }
  return { label: "In stock", tone: "is-good" };
}

export function MenuManager({ mode, itemId }: { mode: "list" | "create" | "edit"; itemId?: string }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const categories = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => apiFetch("/api/v1/admin/categories").then((response) => readJson(response, z.array(categorySchema))),
  });
  const menu = useQuery({
    queryKey: ["admin-menu", query],
    queryFn: () =>
      apiFetch(
        `/api/v1/admin/menu?include_inactive=false&sort=recommended&limit=50&q=${encodeURIComponent(query)}`,
      ).then((response) => readJson(response, menuListSchema)),
    enabled: mode === "list",
    placeholderData: keepPreviousData,
  });

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await apiFetch("/api/v1/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    setName("");
    await queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
    setMessage("Category saved.");
  }

  async function moveItem(itemId: string, direction: "up" | "down") {
    setMessage("");
    const response = await apiFetch(`/api/v1/admin/menu/${itemId}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin-menu"] });
    setMessage("Item order saved.");
  }

  if (mode === "list") {
    const items = menu.data?.items ?? [];
    return (
      <>
        {message ? <Notice>{message}</Notice> : null}
        <div className="mgr-split">
          <Panel title="Categories" subtitle="Students browse categories in this order.">
            <form className="mgr-toolbar" onSubmit={addCategory}>
              <label className="mgr-field min-w-0 flex-1">
                <span>Category name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required className={textInputClass} />
              </label>
              <Button type="submit">Add category</Button>
            </form>
            <CategoryOrder
              categories={categories.data ?? []}
              loading={categories.isLoading}
              onChanged={async (text) => {
                await queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
                await queryClient.invalidateQueries({ queryKey: ["admin-menu"] });
                setMessage(text);
              }}
            />
          </Panel>

          <Panel
            title="Dishes"
            subtitle="Student menu order. Hidden dishes stay off this list."
            action={menu.data ? <span className="mgr-badge is-info">{items.length} shown</span> : null}
          >
            <label className="mgr-field">
              <span>Search menu</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={textInputClass}
                placeholder="Dish name"
              />
            </label>
            {menu.isLoading ? <p className="mgr-empty">Loading menu.</p> : null}
            {menu.isError ? <Notice tone="error">{menu.error.message}</Notice> : null}
            {menu.data && items.length === 0 ? (
              <EmptyState>{query ? "No dish matches that search." : "No dishes yet. Add your first menu item."}</EmptyState>
            ) : null}
            <ul className={cn("mgr-list", menu.isPlaceholderData && "is-stale")}>
              {items.map((item) => {
                const shelf = shelfLabel(item);
                return (
                  <li key={item.id} className="mgr-list-row">
                    <div className="min-w-0">
                      <Link href={`/admin/menu/${item.id}/edit`} className="mgr-row-title hover:underline">
                        {item.name}
                      </Link>
                      <p className="mgr-row-meta">
                        {item.category_name} · {formatInrFromPaise(item.price_paise)}
                      </p>
                      <span className="mgr-badges mt-1.5">
                        <span className={cn("mgr-badge", shelf.tone)}>{shelf.label}</span>
                        {(item.reserved_qty ?? 0) > 0 ? (
                          <span className="mgr-badge is-info">{item.reserved_qty} reserved</span>
                        ) : null}
                        {item.is_featured ? <span className="mgr-badge is-warn">{"Today's special"}</span> : null}
                        {item.is_demo ? <span className="mgr-badge">Demo</span> : null}
                      </span>
                    </div>
                    <span className="mgr-actions">
                      <Button type="button" size="sm" variant="outline" onClick={() => moveItem(item.id, "up")}>
                        Move up
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => moveItem(item.id, "down")}>
                        Move down
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </>
    );
  }

  return (
    <ItemForm
      itemId={itemId}
      categories={categories.data ?? []}
      categoriesLoading={categories.isLoading}
      onSaved={(text) => setMessage(text)}
      message={message}
    />
  );
}

function CategoryOrder({
  categories,
  loading,
  onChanged,
}: {
  categories: { id: string; name: string; is_active: boolean }[];
  loading: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  const active = categories.filter((category) => category.is_active);
  const archived = categories.filter((category) => !category.is_active);

  async function move(id: string, direction: "up" | "down") {
    const response = await apiFetch(`/api/v1/admin/categories/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
    if (!response.ok) {
      await onChanged(await readError(response));
      return;
    }
    await onChanged("Category order saved.");
  }

  async function rename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    const response = await apiFetch(`/api/v1/admin/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    await onChanged(response.ok ? "Category renamed." : await readError(response));
  }

  async function setActive(id: string, isActive: boolean) {
    const response = await apiFetch(`/api/v1/admin/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    });
    await onChanged(response.ok ? "Category updated." : await readError(response));
  }

  return (
    <div className="grid gap-3">
      <h3 className="mgr-kicker">Category order</h3>
      {loading ? <SkeletonLines count={3} /> : null}
      {!loading && active.length === 0 ? <EmptyState>No categories yet.</EmptyState> : null}
      <ul className="mgr-list">
        {active.map((category, index) => (
          <li key={category.id} className="mgr-list-row">
            <span className="mgr-badge" aria-hidden="true">
              {index + 1}
            </span>
            <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => rename(event, category.id)}>
              <label className="min-w-0 flex-1 text-sm">
                <span className="sr-only">Category name</span>
                <input name="name" defaultValue={category.name} required className={textInputClass} />
              </label>
              <Button type="submit" size="sm" variant="outline" className="self-center">
                Rename
              </Button>
            </form>
            <span className="mgr-actions">
              <Button type="button" size="sm" variant="outline" onClick={() => move(category.id, "up")}>
                Move up
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => move(category.id, "down")}>
                Move down
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setActive(category.id, false)}>
                Hide
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {archived.length > 0 ? (
        <details className="mgr-details">
          <summary className="cursor-pointer text-sm">Archived categories ({archived.length})</summary>
          <ul className="mgr-list mt-2">
            {archived.map((category) => (
              <li key={category.id} className="mgr-list-row is-dim">
                <span className="text-sm">{category.name}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => setActive(category.id, true)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ItemForm({
  itemId,
  categories,
  categoriesLoading,
  message,
  onSaved,
}: {
  itemId?: string;
  categories: { id: string; name: string; is_active?: boolean }[];
  categoriesLoading: boolean;
  message: string;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const stations = useQuery({
    queryKey: ["admin-stations"],
    queryFn: () => apiFetch("/api/v1/admin/stations").then((response) => readJson(response, z.array(stationSchema))),
  });
  const existing = useQuery({
    queryKey: ["admin-menu-item", itemId],
    enabled: Boolean(itemId),
    queryFn: () =>
      apiFetch(`/api/v1/admin/menu/${itemId}`).then((response) => readJson(response, menuItemSchema)),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const optionsPending =
    categoriesLoading || stations.isLoading || (Boolean(itemId) && existing.isLoading);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = menuItemFormSchema.safeParse({
      name: form.get("name"),
      description: form.get("description"),
      price: form.get("price"),
      prepSeconds: form.get("prepSeconds"),
      categoryId: form.get("categoryId"),
      stationId: form.get("stationId"),
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        name: fieldErrors.name?.[0] ?? "",
        price: fieldErrors.price?.[0] ?? "",
        prepSeconds: fieldErrors.prepSeconds?.[0] ?? "",
        categoryId: fieldErrors.categoryId?.[0] ?? "",
        stationId: fieldErrors.stationId?.[0] ?? "",
      });
      return;
    }
    setErrors({});
    const pricePaise = rupeesToPaise(parsed.data.price);
    if (pricePaise === null) {
      return;
    }
    const payload = {
      name: parsed.data.name,
      description: parsed.data.description,
      price_paise: pricePaise,
      prep_seconds: parsed.data.prepSeconds,
      category_id: parsed.data.categoryId,
      station_id: parsed.data.stationId,
      is_active: form.get("isActive") === "on",
      is_available: form.get("isAvailable") === "on",
      is_vegetarian: form.get("isVegetarian") === "on",
      is_featured: form.get("isFeatured") === "on",
      initial_available_qty: itemId ? undefined : Number(form.get("stock") || 0),
      ...nutritionPayload(form),
    };
    setSaving(true);
    setFormError("");
    try {
      const response = await apiFetch(itemId ? `/api/v1/admin/menu/${itemId}` : "/api/v1/admin/menu", {
        method: itemId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setFormError(await readError(response));
        return;
      }
      const saved = menuItemSchema.parse(await response.json());
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        bytes.forEach((value) => {
          binary += String.fromCharCode(value);
        });
        const uploaded = await apiFetch(`/api/v1/admin/menu/${saved.id}/image`, {
          method: "POST",
          body: JSON.stringify({
            content_base64: btoa(binary),
            content_type: file.type,
          }),
        });
        if (!uploaded.ok) {
          setFormError(await readError(uploaded));
          return;
        }
      }
      onSaved(itemId ? "Item updated." : "Item created.");
      if (!itemId) {
        router.push(`/admin/menu/${saved.id}/edit`);
      }
    } finally {
      setSaving(false);
    }
  }

  if (optionsPending) {
    return (
      <Panel>
        <p className="sr-only">Loading the item form.</p>
        <SkeletonLines count={5} />
      </Panel>
    );
  }

  return (
    <>
      <form key={itemId ?? "new"} className="mgr-form" onSubmit={onSubmit}>
        <Panel title="Basics" subtitle="What students see on the menu card.">
          <div className="mgr-form-grid">
            <label className="mgr-field is-wide">
              <span>Name</span>
              <input name="name" required defaultValue={existing.data?.name} className={textInputClass} />
              {errors.name ? <span className="text-destructive">{errors.name}</span> : null}
            </label>
            <label className="mgr-field is-wide">
              <span>Description</span>
              <textarea
                name="description"
                rows={3}
                defaultValue={existing.data?.description}
                className={cn(textInputClass, "py-2.5")}
              />
            </label>
            <label className="mgr-field">
              <span>Price in rupees</span>
              <input
                name="price"
                inputMode="decimal"
                required
                defaultValue={
                  existing.data
                    ? `${Math.floor(existing.data.price_paise / 100)}.${(existing.data.price_paise % 100).toString().padStart(2, "0")}`
                    : undefined
                }
                className={textInputClass}
              />
              {errors.price ? <span className="text-destructive">{errors.price}</span> : null}
            </label>
            <label className="mgr-field">
              <span>Preparation seconds</span>
              <input
                name="prepSeconds"
                type="number"
                min={30}
                max={7200}
                defaultValue={existing.data?.prep_seconds ?? 300}
                required
                className={textInputClass}
              />
              {errors.prepSeconds ? <span className="text-destructive">{errors.prepSeconds}</span> : null}
            </label>
          </div>
        </Panel>

        <Panel title="Kitchen and shelf" subtitle="Where it is cooked and whether students can order it.">
          <div className="mgr-form-grid">
            <label className="mgr-field">
              <span>Category</span>
              <select name="categoryId" required className={textInputClass} defaultValue={existing.data?.category_id ?? ""}>
                <option value="" disabled>
                  Choose
                </option>
                {categories
                  .filter((category) => category.is_active !== false || category.id === existing.data?.category_id)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
              {errors.categoryId ? <span className="text-destructive">{errors.categoryId}</span> : null}
            </label>
            <label className="mgr-field">
              <span>Station</span>
              <select name="stationId" required className={textInputClass} defaultValue={existing.data?.station_id ?? ""}>
                <option value="" disabled>
                  Choose
                </option>
                {stations.data?.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </select>
              {errors.stationId ? <span className="text-destructive">{errors.stationId}</span> : null}
            </label>
            {itemId ? null : (
              <label className="mgr-field">
                <span>Initial stock</span>
                <select name="stock" className={textInputClass} defaultValue="100">
                  <option value="100">In stock</option>
                  <option value="5">Few left</option>
                  <option value="0">Out of stock</option>
                </select>
              </label>
            )}
          </div>
          <div className="mgr-checks">
            <label className="mgr-check">
              <input name="isActive" type="checkbox" defaultChecked={existing.data?.is_active ?? true} />
              Active
            </label>
            <label className="mgr-check">
              <input name="isAvailable" type="checkbox" defaultChecked={existing.data?.is_available ?? true} />
              Available
            </label>
            <label className="mgr-check">
              <input name="isVegetarian" type="checkbox" defaultChecked={existing.data?.is_vegetarian ?? true} />
              Vegetarian
            </label>
            <label className="mgr-check">
              <input name="isFeatured" type="checkbox" defaultChecked={existing.data?.is_featured ?? false} />
              {"Today's special"}
            </label>
          </div>
        </Panel>

        <Panel
          title="Nutrition"
          subtitle="Leave calories blank when you do not have a source. Illustrative numbers must stay labeled as illustrative."
        >
          <div className="mgr-form-grid">
            <label className="mgr-field">
              <span>Calories per serving</span>
              <input
                name="calories"
                inputMode="numeric"
                defaultValue={existing.data?.calories_kcal ?? ""}
                className={textInputClass}
              />
            </label>
            <label className="mgr-field">
              <span>Serving size</span>
              <input
                name="serving"
                maxLength={80}
                defaultValue={existing.data?.serving_size_description ?? ""}
                className={textInputClass}
              />
            </label>
            <label className="mgr-field">
              <span>Source</span>
              <select name="nutritionSource" className={textInputClass} defaultValue={existing.data?.nutrition_source ?? ""}>
                <option value="">Calories unavailable</option>
                <option value="VERIFIED">Verified</option>
                <option value="ILLUSTRATIVE">Illustrative</option>
              </select>
            </label>
            <label className="mgr-field">
              <span>Reference</span>
              <input
                name="nutritionReference"
                maxLength={160}
                defaultValue={existing.data?.nutrition_reference ?? ""}
                className={textInputClass}
              />
            </label>
          </div>
        </Panel>

        <Panel title="Photo" subtitle="JPEG, PNG, or WebP. A new upload replaces the current photo.">
          <label className="mgr-field">
            <span>Photo</span>
            <input
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="mgr-file"
            />
          </label>
        </Panel>

        {formError ? <Notice tone="error">{formError}</Notice> : null}
        {message ? <Notice tone="success">{message}</Notice> : null}
        <div className="mgr-form-bar">
          <Button type="submit" disabled={saving}>
            {itemId ? "Save item" : "Create item"}
          </Button>
          {saving ? <span className="mgr-card-sub">Saving…</span> : null}
        </div>
      </form>
      {itemId ? <PairingEditor itemId={itemId} /> : null}
    </>
  );
}

function nutritionPayload(form: FormData) {
  const raw = String(form.get("calories") ?? "").trim();
  const source = String(form.get("nutritionSource") ?? "");
  const serving = String(form.get("serving") ?? "").trim();
  const reference = String(form.get("nutritionReference") ?? "").trim();
  if (!raw && !source) {
    return {
      calories_kcal: null,
      nutrition_source: null,
      serving_size_description: serving || null,
      nutrition_reference: null,
    };
  }
  return {
    calories_kcal: Number(raw),
    nutrition_source: source || null,
    serving_size_description: serving || null,
    nutrition_reference: reference || null,
  };
}

const pairingRowSchema = z.object({
  id: z.string(),
  suggested_item_id: z.string(),
  suggested_name: z.string(),
  priority: z.number(),
  is_active: z.boolean(),
});

function PairingEditor({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const pairings = useQuery({
    queryKey: ["admin-pairings", itemId],
    queryFn: () =>
      apiFetch(`/api/v1/admin/menu/${itemId}/pairings`).then((response) =>
        readJson(response, z.array(pairingRowSchema)),
      ),
  });
  const menu = useQuery({
    queryKey: ["admin-menu", "pair-options"],
    queryFn: () => apiFetch("/api/v1/admin/menu?limit=50").then((response) => readJson(response, menuListSchema)),
  });

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    const response = await apiFetch(`/api/v1/admin/menu/${itemId}/pairings`, {
      method: "POST",
      body: JSON.stringify({
        suggested_item_id: form.get("suggested"),
        priority: Number(form.get("priority") || 0),
      }),
    });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    event.currentTarget.reset();
    await queryClient.invalidateQueries({ queryKey: ["admin-pairings", itemId] });
    setMessage("Pairing saved. Students only see it while that item is in stock.");
  }

  async function remove(id: string) {
    const response = await apiFetch(`/api/v1/admin/menu/pairings/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin-pairings", itemId] });
  }

  const rows = pairings.data ?? [];
  return (
    <Panel title="Pairings" subtitle="Optional suggestions. They are never added to a cart automatically.">
      {pairings.isLoading ? <SkeletonLines count={2} /> : null}
      {pairings.data && rows.length === 0 ? <EmptyState>No pairings yet.</EmptyState> : null}
      <ul className="mgr-list text-sm">
        {rows.map((row) => (
          <li key={row.id} className="mgr-list-row">
            <span>
              <span className="mgr-row-title">{row.suggested_name}</span>
              <span className="mgr-row-meta block">Priority {row.priority}</span>
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => remove(row.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end" onSubmit={add}>
        <label className="mgr-field">
          <span>Suggest with this dish</span>
          <select name="suggested" required className={textInputClass} defaultValue="">
            <option value="" disabled>
              Suggest
            </option>
            {menu.data?.items
              .filter((item) => item.id !== itemId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="mgr-field">
          <span>Priority</span>
          <input name="priority" type="number" min={0} max={100} defaultValue={0} className={textInputClass} />
        </label>
        <Button type="submit">Add pairing</Button>
      </form>
      {message ? <Notice>{message}</Notice> : null}
    </Panel>
  );
}

type StationFilter = "all" | "active" | "inactive";

export function StationDesk() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(2);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<StationFilter>("all");
  const [find, setFind] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const stations = useQuery({
    queryKey: ["admin-stations"],
    queryFn: () => apiFetch("/api/v1/admin/stations").then((response) => readJson(response, z.array(stationSchema))),
  });
  const save = useMutation({
    mutationFn: async () => {
      const response = await apiFetch("/api/v1/admin/stations", {
        method: "POST",
        body: JSON.stringify({ name, parallel_capacity: capacity }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
    },
    onSuccess: async () => {
      setName("");
      setMessage("Station saved.");
      await queryClient.invalidateQueries({ queryKey: ["admin-stations"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  async function toggle(station: z.infer<typeof stationSchema>) {
    setBusyId(station.id);
    try {
      const response = await apiFetch(`/api/v1/admin/stations/${station.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !station.is_active }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      setMessage(`${station.name} ${station.is_active ? "paused" : "is active again"}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin-stations"] });
    } finally {
      setBusyId(null);
    }
  }

  const all = stations.data ?? [];
  const activeCount = all.filter((station) => station.is_active).length;
  const slots = all.filter((station) => station.is_active).reduce((sum, station) => sum + station.parallel_capacity, 0);
  const needle = find.trim().toLowerCase();
  const visible = all.filter(
    (station) =>
      (filter === "all" || (filter === "active" ? station.is_active : !station.is_active)) &&
      (!needle || station.name.toLowerCase().includes(needle)),
  );

  return (
    <section className="grid gap-4">
      <StatGrid>
        <StatTile label="Active lines" value={stations.data ? activeCount : "—"} note="Accepting new tasks" tone="#3df28b" />
        <StatTile label="Parallel slots" value={stations.data ? slots : "—"} note="Dishes cooking at once" tone="#4aa8ff" />
        <StatTile label="Paused" value={stations.data ? all.length - activeCount : "—"} note="Not taking new tasks" tone="#ff8d7a" />
      </StatGrid>

      <Panel title="Add a station" subtitle="Name a cooking line and how many dishes it can prepare at the same time." tone="#3df28b">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="mgr-field">
            <span>Station name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required className={textInputClass} />
          </label>
          <label className="mgr-field">
            <span>Capacity</span>
            <input
              type="number"
              min={1}
              max={20}
              value={capacity}
              onChange={(event) => setCapacity(Number(event.target.value))}
              className={textInputClass}
            />
          </label>
          <Button type="submit" disabled={save.isPending}>
            Add station
          </Button>
        </form>
      </Panel>

      {message ? <Notice tone={save.isError ? "error" : "success"}>{message}</Notice> : null}

      <Panel
        title="Lines"
        subtitle={stations.data ? `${visible.length} of ${all.length} shown` : "Loading lines"}
        action={
          <Segmented<StationFilter>
            label="Show lines"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: all.length },
              { value: "active", label: "Active", count: activeCount },
              { value: "inactive", label: "Paused", count: all.length - activeCount },
            ]}
          />
        }
      >
        <input
          type="search"
          className="mgr-search"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="Find a line"
          aria-label="Find a line"
        />
        {stations.isLoading ? <SkeletonLines count={3} /> : null}
        {stations.isError ? <Notice tone="error">{stations.error.message}</Notice> : null}
        {stations.data && visible.length === 0 ? <EmptyState>No lines match.</EmptyState> : null}
        <ul className="mgr-station-grid">
          {visible.map((station) => (
            <li key={station.id} className={cn("mgr-station-card", !station.is_active && "is-dim")}>
              <div className="flex items-start justify-between gap-2">
                <p className="mgr-row-title">{station.name}</p>
                <span className="mgr-badges">
                  <span className={cn("mgr-badge", station.is_active ? "is-good" : "is-bad")}>
                    {station.is_active ? "Active" : "Inactive"}
                  </span>
                  {station.is_demo ? <span className="mgr-badge">Demo</span> : null}
                </span>
              </div>
              <p className="mgr-row-meta">Parallel capacity {station.parallel_capacity}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === station.id}
                onClick={() => toggle(station)}
              >
                {station.is_active ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

const stockLevelEnum = z.enum(["IN_STOCK", "FEW_LEFT", "OUT_OF_STOCK"]);

const stockRowSchema = z
  .object({
    menu_item_id: z.union([z.string(), z.number()]).transform(String),
    name: z.string(),
    available_qty: z.number(),
    reserved_qty: z.number().default(0),
    consumed_qty: z.number().default(0),
    // Accept anything here — older API builds omit or mistype the field.
    stock_level: z.unknown().optional(),
    low_stock: z.boolean().optional(),
    out_of_stock: z.boolean().optional(),
  })
  .transform((row) => {
    const parsedLevel = stockLevelEnum.safeParse(row.stock_level);
    const level: StockLevel = parsedLevel.success
      ? parsedLevel.data
      : stockLevel({ available_qty: row.available_qty });
    return {
      menu_item_id: row.menu_item_id,
      name: row.name,
      available_qty: row.available_qty,
      reserved_qty: row.reserved_qty,
      consumed_qty: row.consumed_qty,
      stock_level: level,
      low_stock: level === "FEW_LEFT",
      out_of_stock: level === "OUT_OF_STOCK",
    };
  });

const stockSchema = z.object({
  rows: z.array(stockRowSchema),
  service_date: z.string().optional(),
});

type ShelfLevel = StockLevel;

const shelfOptions: { level: ShelfLevel; label: string; hint: string }[] = [
  { level: "IN_STOCK", label: "In stock", hint: "Plenty to sell" },
  { level: "FEW_LEFT", label: "Few left", hint: "Almost gone" },
  { level: "OUT_OF_STOCK", label: "Out of stock", hint: "Hide from orders" },
];

export function StockDesk() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [show, setShow] = useState<ShelfLevel | "">("");
  const [find, setFind] = useState("");
  const stock = useQuery({
    queryKey: ["admin-stock"],
    queryFn: () => apiFetch("/api/v1/admin/stock").then((response) => readJson(response, stockSchema)),
  });

  async function save(itemId: string, level: ShelfLevel, name: string) {
    setBusyId(itemId);
    setMessage("");
    try {
      // Prefer stock_level; fall back to quantity for older API processes still running.
      let response = await apiFetch(`/api/v1/admin/stock/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ stock_level: level, reason: "Shelf status" }),
      });
      if (!response.ok && response.status === 422) {
        response = await apiFetch(`/api/v1/admin/stock/${itemId}`, {
          method: "PATCH",
          body: JSON.stringify({
            available_qty: STOCK_LEVEL_QTY[level],
            reason: "Shelf status",
          }),
        });
      }
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      const label = shelfOptions.find((option) => option.level === level)?.label ?? level;
      setMessage(`${name}: marked ${label}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin-stock"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-menu"] });
      await queryClient.invalidateQueries({ queryKey: ["menu"] });
    } finally {
      setBusyId(null);
    }
  }

  const rows = stock.data?.rows ?? [];
  const counts = {
    in: rows.filter((row) => row.stock_level === "IN_STOCK").length,
    few: rows.filter((row) => row.stock_level === "FEW_LEFT").length,
    out: rows.filter((row) => row.stock_level === "OUT_OF_STOCK").length,
  };
  const needle = find.trim().toLowerCase();
  const visible = rows.filter(
    (row) => (!show || row.stock_level === show) && (!needle || row.name.toLowerCase().includes(needle)),
  );

  return (
    <section className="stock-desk grid gap-4" data-testid="stock-desk">
      <StatGrid>
        <StatTile label="In stock" value={counts.in} note="Students can order" tone="#3df28b" />
        <StatTile label="Few left" value={counts.few} note="Shown as almost gone" tone="#f6d15a" />
        <StatTile label="Out of stock" value={counts.out} note="Blocked at checkout" tone="#ff5c8a" />
      </StatGrid>
      {message ? (
        <p role="status" className="mgr-notice is-success" data-testid="stock-message">
          {message}
        </p>
      ) : null}
      <Panel
        title="Shelf"
        subtitle={stock.data ? `${visible.length} of ${rows.length} dishes shown` : "Loading dishes"}
        action={
          <Segmented<ShelfLevel | "">
            label="Show dishes"
            value={show}
            onChange={setShow}
            options={[
              { value: "", label: "All", count: rows.length },
              { value: "IN_STOCK", label: "In stock", count: counts.in },
              { value: "FEW_LEFT", label: "Few left", count: counts.few },
              { value: "OUT_OF_STOCK", label: "Out", count: counts.out },
            ]}
          />
        }
      >
        <input
          type="search"
          className="mgr-search"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="Find a dish"
          aria-label="Find a dish"
        />
        {stock.isLoading ? <p className="mgr-empty">Loading stock.</p> : null}
        {stock.isError ? <Notice tone="error">{stock.error.message}</Notice> : null}
        {stock.data && visible.length === 0 ? <EmptyState>No dishes match.</EmptyState> : null}
        <ul className="stock-grid">
          {visible.map((row) => (
            <li
              key={row.menu_item_id}
              className="stock-row mgr-station-card"
              data-level={row.stock_level}
              data-testid="stock-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="mgr-row-title">{row.name}</p>
                  <p className="mgr-row-meta">
                    {shelfOptions.find((option) => option.level === row.stock_level)?.label}
                    {row.reserved_qty > 0 ? ` · ${row.reserved_qty} reserved on open tickets` : ""}
                  </p>
                </div>
                <span className={`stock-pill stock-pill-${row.stock_level.toLowerCase()}`}>
                  {shelfOptions.find((option) => option.level === row.stock_level)?.label}
                </span>
              </div>
              <div className="stock-level-group" role="group" aria-label={`Shelf status for ${row.name}`}>
                {shelfOptions.map((option) => {
                  const active = row.stock_level === option.level;
                  return (
                    <button
                      key={option.level}
                      type="button"
                      className={`stock-level-btn ${active ? "is-active" : ""}`}
                      data-level={option.level}
                      disabled={busyId === row.menu_item_id}
                      aria-pressed={active}
                      onClick={() => void save(row.menu_item_id, option.level, row.name)}
                    >
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.hint}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

const managerOrdersSchema = z.object({
  orders: z.array(
    z.object({
      id: z.string(),
      ticket_number: z.string(),
      status: z.string(),
      total_paise: z.number(),
      created_at: z.string().optional(),
      student_name: z.string().nullable().optional(),
      payment: z.object({ method: z.string(), status: z.string(), amount_paise: z.number() }),
      items: z.array(z.object({ item_name: z.string(), quantity: z.number(), line_total_paise: z.number() })),
    }),
  ),
  total: z.number().optional(),
  totals: z.object({
    placed_paise: z.number(),
    cancelled_paise: z.number(),
    cash_collected_paise: z.null(),
    cash_collected_note: z.string(),
  }),
});

const ORDER_STATUSES = [
  ["PLACED", "Placed"],
  ["ACCEPTED", "Accepted"],
  ["QUEUED", "Queued"],
  ["PREPARING", "Preparing"],
  ["READY", "Ready"],
  ["PICKED_UP", "Picked up"],
  ["UNCLAIMED", "Unclaimed"],
  ["CANCELLED", "Cancelled"],
  ["REJECTED", "Rejected"],
] as const;

const PAGE_SIZE = 25;

function orderTime(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}

export function ManagerOrders() {
  const [status, setStatus] = useState("");
  const [on, setOn] = useState("");
  const [find, setFind] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const orders = useQuery({
    queryKey: ["admin-orders", status, on, limit],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (status) {
        params.set("status", status);
      }
      if (on) {
        params.set("on", on);
      }
      return apiFetch(`/api/v1/admin/orders?${params.toString()}`).then((response) =>
        readJson(response, managerOrdersSchema),
      );
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const rows = orders.data?.orders ?? [];
  const total = orders.data?.total ?? rows.length;
  const needle = find.trim().toLowerCase();
  const visible = rows.filter(
    (order) =>
      !needle ||
      order.ticket_number.toLowerCase().includes(needle) ||
      (order.student_name ?? "").toLowerCase().includes(needle) ||
      order.items.some((item) => item.item_name.toLowerCase().includes(needle)),
  );

  return (
    <section className="grid gap-4" aria-labelledby="all-orders-heading">
      {orders.data ? (
        <StatGrid>
          <StatTile
            label="Matching tickets"
            value={total}
            note={on ? `Service date ${on}` : "All service dates"}
            tone="#4aa8ff"
          />
          <StatTile
            label="Waiting to be accepted"
            value={formatInrFromPaise(orders.data.totals.placed_paise)}
            note="Value of orders still in Placed"
            tone="#f6d15a"
          />
          <StatTile
            label="Cancelled value"
            value={formatInrFromPaise(orders.data.totals.cancelled_paise)}
            note="Never counted as cash"
            tone="#ff8d7a"
          />
        </StatGrid>
      ) : null}

      <Panel
        title="All orders"
        titleId="all-orders-heading"
        subtitle={orders.data ? orders.data.totals.cash_collected_note : "Loading tickets"}
      >
        <div className="mgr-toolbar">
          <label className="mgr-field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setLimit(PAGE_SIZE);
              }}
              className={textInputClass}
            >
              <option value="">All</option>
              {ORDER_STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mgr-field">
            <span>Service date</span>
            <input
              type="date"
              value={on}
              onChange={(event) => {
                setOn(event.target.value);
                setLimit(PAGE_SIZE);
              }}
              className={textInputClass}
            />
          </label>
          {on || status ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-1"
              onClick={() => {
                setOn("");
                setStatus("");
                setLimit(PAGE_SIZE);
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <input
            type="search"
            className="mgr-search"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Search ticket, student, dish"
            aria-label="Search loaded orders"
          />
        </div>

        {orders.isError ? <Notice tone="error">{orders.error.message}</Notice> : null}
        {orders.isLoading ? <SkeletonLines count={5} /> : null}
        {orders.data ? (
          <div className={cn("mgr-table-wrap", orders.isPlaceholderData && "is-stale")}>
            <table className="mgr-table">
              <thead>
                <tr>
                  <th scope="col">Ticket</th>
                  <th scope="col">Items</th>
                  <th scope="col">Status</th>
                  <th scope="col">Payment</th>
                  <th scope="col" className="is-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="mgr-empty">
                      {needle ? "No loaded order matches your search." : "No orders match these filters."}
                    </td>
                  </tr>
                ) : null}
                {visible.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <span className="mgr-ticket">{order.ticket_number}</span>
                      <span className="mgr-cell-sub">
                        {order.student_name ?? "Student"}
                        {order.created_at ? ` · ${orderTime(order.created_at)}` : ""}
                      </span>
                    </td>
                    <td>
                      {order.items.map((item) => (
                        <span key={`${order.id}-${item.item_name}`} className="block">
                          {item.item_name} × {item.quantity}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className={cn("mgr-badge", `is-${order.status.toLowerCase()}`)}>
                        {order.status.replaceAll("_", " ").toLowerCase()}
                      </span>
                    </td>
                    <td>
                      <span className={cn("mgr-badge", `is-pay-${order.payment.status.toLowerCase()}`)}>
                        {order.payment.method.toLowerCase()} · {order.payment.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="is-num">{formatInrFromPaise(order.total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {orders.data && rows.length < total ? (
          <div className="mgr-actions justify-between">
            <span className="mgr-card-sub">
              Showing {rows.length} of {total}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={orders.isFetching || limit >= 50}
              onClick={() => setLimit((current) => Math.min(50, current + PAGE_SIZE))}
            >
              {limit >= 50 ? "Narrow by date to see older tickets" : "Show more"}
            </Button>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}
