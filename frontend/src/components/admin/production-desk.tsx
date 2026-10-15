"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { batchListSchema, fieldClass } from "@/lib/intelligence";
import { menuItemSchema } from "@/lib/ordering";

const menuListSchema = z.object({ items: z.array(menuItemSchema) });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ProductionDesk() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(today());
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const menu = useQuery({
    queryKey: ["admin-menu-production", query],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/menu?limit=50&q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return menuListSchema.parse(await response.json());
    },
  });
  const batches = useQuery({
    queryKey: ["production", day],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/production?date_from=${day}&date_to=${day}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return batchListSchema.parse(await response.json());
    },
  });
  const reconciliation = useQuery({
    queryKey: ["reconciliation", day],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/production/reconciliation?service_date=${day}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return z
        .object({
          note: z.string(),
          items: z.array(
            z.object({
              item_name: z.string(),
              produced: z.number(),
              served_counter: z.number(),
              remaining: z.number(),
              discarded: z.number(),
              online_picked_up: z.number(),
              warnings: z.array(z.string()),
            }),
          ),
        })
        .parse(await response.json());
    },
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/v1/admin/production", {
        method: "POST",
        body: JSON.stringify({
          menu_item_id: itemId,
          service_date: day,
          service_period: "ALL_DAY",
          produced_qty: Number(quantity),
          prepared_at: new Date().toISOString(),
          notes,
          idempotency_key: newKey(),
        }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      setMessage("Production batch saved. Saleable stock was not changed.");
      await queryClient.invalidateQueries({ queryKey: ["production"] });
      await queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
    } finally {
      setBusy(false);
    }
  }

  const items = menu.data?.items.filter((item) => item.is_active) ?? [];
  return (
    <section className="space-y-6" data-testid="production-desk">
      <div>
        <h1 className="font-display text-4xl">Production</h1>
        <p className="text-sm text-muted-foreground">
          Portions the kitchen prepared. This ledger is separate from saleable stock and from online orders.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={save} data-testid="production-form">
        <label className="grid gap-1 text-sm">
          Date
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={fieldClass} data-testid="production-date" />
        </label>
        <label className="grid gap-1 text-sm">
          Find item
          <input value={query} onChange={(event) => setQuery(event.target.value)} className={fieldClass} data-testid="production-search" />
        </label>
        <label className="grid gap-1 text-sm">
          Item
          <select value={itemId} onChange={(event) => setItemId(event.target.value)} className={fieldClass} data-testid="production-item" required>
            <option value="">Choose an item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Portions prepared
          <input type="number" min={1} max={5000} value={quantity} onChange={(event) => setQuantity(event.target.value)} className={fieldClass} data-testid="production-qty" required />
        </label>
        <label className="grid gap-1 text-sm">
          Notes
          <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} maxLength={400} />
        </label>
        <Button type="submit" disabled={busy || !itemId} data-testid="production-save">
          Record batch
        </Button>
      </form>
      {message ? <p data-testid="production-notice">{message}</p> : null}
      {batches.isLoading ? <p>Loading batches.</p> : null}
      {batches.isError ? <p role="alert">{batches.error.message}</p> : null}
      {batches.data && batches.data.batches.length === 0 ? <p>No batches on this date.</p> : null}
      <ul className="space-y-3" data-testid="production-list">
        {batches.data?.batches.map((batch) => (
          <li key={batch.id} className="rounded-2xl border border-border p-4">
            <p className="font-medium">
              {batch.batch_code} · {batch.item_name}
            </p>
            <p className="text-sm text-muted-foreground">
              Produced {batch.produced_qty}, counter served {batch.served_counter_qty}, remaining {batch.remaining_qty}, discarded {batch.discarded_qty}. {batch.equation}
            </p>
          </li>
        ))}
      </ul>
      <div data-testid="reconciliation">
        <h2 className="font-display text-2xl">Reconciliation</h2>
        <p className="text-sm text-muted-foreground">{reconciliation.data?.note}</p>
        {reconciliation.data?.items.map((row) => (
          <p key={row.item_name} className="mt-2 text-sm">
            {row.item_name}: produced {row.produced}, counter {row.served_counter}, remaining {row.remaining}, discarded {row.discarded}, online pickups {row.online_picked_up}.
            {row.warnings.map((warning) => (
              <span key={warning} className="block text-muted-foreground">
                {warning}
              </span>
            ))}
          </p>
        ))}
      </div>
    </section>
  );
}
