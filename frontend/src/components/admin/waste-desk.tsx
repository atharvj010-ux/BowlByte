"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { fieldClass, wasteListSchema } from "@/lib/intelligence";
import { menuItemSchema } from "@/lib/ordering";

const reasons = ["UNSOLD", "PREPARATION_ERROR", "QUALITY_REJECTION", "SPOILAGE", "OTHER"] as const;
const menuListSchema = z.object({ items: z.array(menuItemSchema) });

export function WasteDesk() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState<(typeof reasons)[number]>("UNSOLD");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const menu = useQuery({
    queryKey: ["admin-menu-waste", query],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/menu?limit=50&q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return menuListSchema.parse(await response.json());
    },
  });
  const waste = useQuery({
    queryKey: ["waste", day],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/waste?date_from=${day}&date_to=${day}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return wasteListSchema.parse(await response.json());
    },
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/v1/admin/waste", {
        method: "POST",
        body: JSON.stringify({
          menu_item_id: itemId,
          service_date: day,
          service_period: "ALL_DAY",
          quantity: Number(quantity),
          reason,
          notes,
          idempotency_key: newKey(),
        }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      setMessage("Discard recorded. Unsold food is not discarded unless you log it.");
      await queryClient.invalidateQueries({ queryKey: ["waste"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" data-testid="waste-desk">
      <div>
        <h1 className="font-display text-4xl">Waste</h1>
        <p className="text-sm text-muted-foreground">
          Only portions a manager recorded as discarded. Completing a kitchen task does not mean food was thrown away.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={save} data-testid="waste-form">
        <label className="grid gap-1 text-sm">
          Date
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={fieldClass} data-testid="waste-date" />
        </label>
        <label className="grid gap-1 text-sm">
          Find item
          <input value={query} onChange={(event) => setQuery(event.target.value)} className={fieldClass} data-testid="waste-search" />
        </label>
        <label className="grid gap-1 text-sm">
          Item
          <select value={itemId} onChange={(event) => setItemId(event.target.value)} className={fieldClass} data-testid="waste-item" required>
            <option value="">Choose an item</option>
            {menu.data?.items.filter((item) => item.is_active).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Discarded portions
          <input type="number" min={1} max={5000} value={quantity} onChange={(event) => setQuantity(event.target.value)} className={fieldClass} data-testid="waste-qty" required />
        </label>
        <label className="grid gap-1 text-sm">
          Reason
          <select value={reason} onChange={(event) => setReason(event.target.value as (typeof reasons)[number])} className={fieldClass} data-testid="waste-reason">
            {reasons.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Notes
          <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} maxLength={400} />
        </label>
        <Button type="submit" disabled={busy || !itemId} data-testid="waste-save">
          Record discard
        </Button>
      </form>
      {message ? <p data-testid="waste-notice">{message}</p> : null}
      {waste.isLoading ? <p>Loading waste records.</p> : null}
      {waste.isError ? <p role="alert">{waste.error.message}</p> : null}
      {waste.data && waste.data.records.length === 0 ? <p>No discards recorded on this date.</p> : null}
      <ul className="space-y-3" data-testid="waste-list">
        {waste.data?.records.map((row) => (
          <li key={row.id} className="rounded-2xl border border-border p-4 text-sm">
            {row.item_name}: {row.quantity} portions, {row.reason.replaceAll("_", " ")}. Source {row.source}.
          </li>
        ))}
      </ul>
    </section>
  );
}
