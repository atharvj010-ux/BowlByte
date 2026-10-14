"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { menuItemFormSchema, menuItemSchema, rupeesToPaise } from "@/lib/ordering";

const categorySchema = z.object({ id: z.string(), name: z.string(), sort_order: z.number() });
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
  return schema.parse(await response.json());
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
      apiFetch(`/api/v1/admin/menu?q=${encodeURIComponent(query)}`).then((response) =>
        readJson(response, menuListSchema),
      ),
    enabled: mode === "list",
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

  if (mode === "list") {
    return (
      <section className="space-y-6">
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={addCategory}>
          <label className="flex-1 space-y-2 text-sm">
            <span className="font-medium">Category name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required className={textInputClass} />
          </label>
          <Button type="submit" className="self-end">
            Add category
          </Button>
        </form>
        {message ? <p role="status">{message}</p> : null}
        <label className="block space-y-2 text-sm">
          <span className="font-medium">Search menu</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className={textInputClass} />
        </label>
        <a href="/admin/menu/new" className="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline">
          Add menu item
        </a>
        {menu.isLoading ? <p>Loading menu.</p> : null}
        {menu.isError ? <p className="text-sm text-destructive">{menu.error.message}</p> : null}
        <ul className="grid gap-3">
          {menu.data?.items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-border bg-card p-4">
              <a href={`/admin/menu/${item.id}/edit`} className="font-medium underline-offset-4 hover:underline">
                {item.name}
              </a>
              <p className="text-sm text-muted-foreground">
                {formatInrFromPaise(item.price_paise)} · {item.available_qty} available ·{" "}
                {item.reserved_qty ?? 0} reserved · {item.is_available ? "Listed" : "Unavailable"}
                {item.is_demo ? " · Demo" : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
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

function ItemForm({
  itemId,
  categories,
  categoriesLoading,
  message,
  onSaved,
}: {
  itemId?: string;
  categories: { id: string; name: string }[];
  categoriesLoading: boolean;
  message: string;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
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
      initial_available_qty: itemId ? undefined : Number(form.get("stock") || 0),
    };
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
  }

  if (optionsPending) {
    return <p>Loading the item form.</p>;
  }

  return (
    <form key={itemId ?? "new"} className="grid max-w-xl gap-4" onSubmit={onSubmit}>
      <label className="space-y-2 text-sm">
        <span className="font-medium">Name</span>
        <input name="name" required defaultValue={existing.data?.name} className={textInputClass} />
        {errors.name ? <span className="text-destructive">{errors.name}</span> : null}
      </label>
      <label className="space-y-2 text-sm">
        <span className="font-medium">Description</span>
        <textarea name="description" defaultValue={existing.data?.description} className={textInputClass} />
      </label>
      <label className="space-y-2 text-sm">
        <span className="font-medium">Price in rupees</span>
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
      <label className="space-y-2 text-sm">
        <span className="font-medium">Preparation seconds</span>
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
      <label className="space-y-2 text-sm">
        <span className="font-medium">Category</span>
        <select name="categoryId" required className={textInputClass} defaultValue={existing.data?.category_id ?? ""}>
          <option value="" disabled>
            Choose
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId ? <span className="text-destructive">{errors.categoryId}</span> : null}
      </label>
      <label className="space-y-2 text-sm">
        <span className="font-medium">Station</span>
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
        <label className="space-y-2 text-sm">
          <span className="font-medium">Initial stock</span>
          <input name="stock" type="number" min={0} defaultValue={10} className={textInputClass} />
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input name="isActive" type="checkbox" defaultChecked={existing.data?.is_active ?? true} />
        Active
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="isAvailable" type="checkbox" defaultChecked={existing.data?.is_available ?? true} />
        Available
      </label>
      <label className="space-y-2 text-sm">
        <span className="font-medium">Photo</span>
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
      </label>
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <Button type="submit">{itemId ? "Save item" : "Create item"}</Button>
    </form>
  );
}

export function StationDesk() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(2);
  const [message, setMessage] = useState("");
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
    const response = await apiFetch(`/api/v1/admin/stations/${station.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !station.is_active }),
    });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin-stations"] });
  }

  return (
    <section className="space-y-5">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="space-y-2 text-sm">
          <span className="font-medium">Station name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className={textInputClass} />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Capacity</span>
          <input
            type="number"
            min={1}
            max={20}
            value={capacity}
            onChange={(event) => setCapacity(Number(event.target.value))}
            className={textInputClass}
          />
        </label>
        <Button type="submit" className="self-end">
          Add station
        </Button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      <ul className="grid gap-3">
        {stations.data?.map((station) => (
          <li key={station.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
            <div>
              <p className="font-medium">{station.name}</p>
              <p className="text-sm text-muted-foreground">
                Parallel capacity {station.parallel_capacity}
                {station.is_demo ? " · Demo" : ""} · {station.is_active ? "Active" : "Inactive"}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => toggle(station)}>
              {station.is_active ? "Deactivate" : "Activate"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const stockSchema = z.object({
  rows: z.array(
    z.object({
      menu_item_id: z.string(),
      name: z.string(),
      available_qty: z.number(),
      reserved_qty: z.number(),
      consumed_qty: z.number(),
      low_stock: z.boolean(),
      out_of_stock: z.boolean(),
    }),
  ),
});

export function StockDesk() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const stock = useQuery({
    queryKey: ["admin-stock"],
    queryFn: () => apiFetch("/api/v1/admin/stock").then((response) => readJson(response, stockSchema)),
  });

  async function save(itemId: string, available: number) {
    const response = await apiFetch(`/api/v1/admin/stock/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ available_qty: available, reason: "Counter count" }),
    });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    setMessage("Stock updated. Reserved portions were left unchanged.");
    await queryClient.invalidateQueries({ queryKey: ["admin-stock"] });
  }

  return (
    <section className="space-y-4">
      {message ? <p role="status">{message}</p> : null}
      {stock.isLoading ? <p>Loading stock.</p> : null}
      {stock.isError ? <p className="text-sm text-destructive">{stock.error.message}</p> : null}
      <ul className="grid gap-3">
        {stock.data?.rows.map((row) => (
          <li key={row.menu_item_id} className="rounded-2xl border border-border bg-card p-4">
            <p className="font-medium">{row.name}</p>
            <p className="text-sm text-muted-foreground">
              Available {row.available_qty} · Reserved {row.reserved_qty} · Consumed {row.consumed_qty}
              {row.out_of_stock ? " · Out of stock" : row.low_stock ? " · Low stock" : ""}
            </p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void save(row.menu_item_id, Number(data.get("available")));
              }}
            >
              <label className="sr-only" htmlFor={`stock-${row.menu_item_id}`}>
                Available portions for {row.name}
              </label>
              <input
                id={`stock-${row.menu_item_id}`}
                name="available"
                type="number"
                min={0}
                defaultValue={row.available_qty}
                className={textInputClass}
              />
              <Button type="submit" variant="outline">
                Set available
              </Button>
            </form>
          </li>
        ))}
      </ul>
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
      student_name: z.string().nullable().optional(),
      payment: z.object({ method: z.string(), status: z.string(), amount_paise: z.number() }),
      items: z.array(z.object({ item_name: z.string(), quantity: z.number(), line_total_paise: z.number() })),
    }),
  ),
  totals: z.object({
    placed_paise: z.number(),
    cancelled_paise: z.number(),
    cash_collected_paise: z.null(),
    cash_collected_note: z.string(),
  }),
});

export function ManagerOrders() {
  const [status, setStatus] = useState("");
  const [on, setOn] = useState("");
  const orders = useQuery({
    queryKey: ["admin-orders", status, on],
    queryFn: () => {
      const params = new URLSearchParams();
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
  });
  return (
    <section className="space-y-4">
      <form className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={textInputClass}>
            <option value="">All</option>
            <option value="PLACED">Placed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Service date</span>
          <input type="date" value={on} onChange={(event) => setOn(event.target.value)} className={textInputClass} />
        </label>
      </form>
      {orders.data ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <p>Placed value {formatInrFromPaise(orders.data.totals.placed_paise)}</p>
          <p>Cancelled value {formatInrFromPaise(orders.data.totals.cancelled_paise)}</p>
          <p>{orders.data.totals.cash_collected_note}</p>
        </div>
      ) : null}
      {orders.isError ? <p className="text-sm text-destructive">{orders.error.message}</p> : null}
      <ul className="grid gap-3">
        {orders.data?.orders.map((order) => (
          <li key={order.id} className="rounded-2xl border border-border bg-card p-4">
            <p className="font-medium">
              {order.ticket_number} · {order.status}
            </p>
            <p className="text-sm text-muted-foreground">
              {order.student_name} · {order.payment.method} {order.payment.status} ·{" "}
              {formatInrFromPaise(order.total_paise)}
            </p>
            <ul className="mt-2 text-sm">
              {order.items.map((item) => (
                <li key={`${order.id}-${item.item_name}`}>
                  {item.item_name} × {item.quantity}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
