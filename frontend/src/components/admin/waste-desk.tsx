"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { EmptyState, Notice, PageHead, Panel, SkeletonLines } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { wasteListSchema } from "@/lib/intelligence";
import { menuItemSchema } from "@/lib/ordering";

const reasons = ["UNSOLD", "PREPARATION_ERROR", "QUALITY_REJECTION", "SPOILAGE", "OTHER"] as const;
const menuListSchema = z.object({ items: z.array(menuItemSchema) });

function reasonLabel(reason: string): string {
  const text = reason.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function WasteDesk() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState<(typeof reasons)[number]>("UNSOLD");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
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
    setFailed(false);
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
        setFailed(true);
        setMessage(await readError(response));
        return;
      }
      setMessage("Discard recorded. Unsold food is not discarded unless you log it.");
      await queryClient.invalidateQueries({ queryKey: ["waste"] });
    } finally {
      setBusy(false);
    }
  }

  const records = waste.data?.records ?? [];
  const totalDiscarded = records.reduce((sum, row) => sum + row.quantity, 0);
  return (
    <section className="grid gap-4" data-testid="waste-desk">
      <PageHead
        kicker="Kitchen ledger"
        title="Waste"
        description="Only portions a manager recorded as discarded. Completing a kitchen task does not mean food was thrown away."
      />
      <div className="mgr-split">
        <Panel title="Record a discard" subtitle="Log food that was thrown away and why." tone="#ff8d7a">
          <form className="mgr-form" onSubmit={save} data-testid="waste-form">
            <label className="mgr-field">
              <span>Date</span>
              <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={textInputClass} data-testid="waste-date" />
            </label>
            <label className="mgr-field">
              <span>Find item</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} className={textInputClass} placeholder="Type to narrow the list" data-testid="waste-search" />
            </label>
            <label className="mgr-field">
              <span>Item</span>
              <select value={itemId} onChange={(event) => setItemId(event.target.value)} className={textInputClass} data-testid="waste-item" required>
                <option value="">Choose an item</option>
                {menu.data?.items.filter((item) => item.is_active).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mgr-form-grid">
              <label className="mgr-field">
                <span>Discarded portions</span>
                <input type="number" min={1} max={5000} value={quantity} onChange={(event) => setQuantity(event.target.value)} className={textInputClass} data-testid="waste-qty" required />
              </label>
              <label className="mgr-field">
                <span>Reason</span>
                <select value={reason} onChange={(event) => setReason(event.target.value as (typeof reasons)[number])} className={textInputClass} data-testid="waste-reason">
                  {reasons.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mgr-field">
              <span>Notes</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className={textInputClass} maxLength={400} />
            </label>
            <Button type="submit" disabled={busy || !itemId} data-testid="waste-save">
              Record discard
            </Button>
          </form>
          {message ? (
            <p className={failed ? "mgr-notice is-error" : "mgr-notice is-success"} role="status" data-testid="waste-notice">
              {message}
            </p>
          ) : null}
        </Panel>

        <Panel
          title="Discards"
          subtitle={waste.data ? `${records.length} records · ${totalDiscarded} portions on ${day}` : `Loading ${day}`}
        >
          {waste.isLoading ? (
            <>
              <p className="sr-only">Loading waste records.</p>
              <SkeletonLines count={2} />
            </>
          ) : null}
          {waste.isError ? <Notice tone="error">{waste.error.message}</Notice> : null}
          {waste.data && records.length === 0 ? <EmptyState>No discards recorded on this date.</EmptyState> : null}
          <ul className="mgr-list" data-testid="waste-list">
            {records.map((row) => (
              <li key={row.id} className="mgr-list-row text-sm">
                <div className="min-w-0">
                  <p className="mgr-row-title">{row.item_name}</p>
                  <p className="mgr-row-meta">
                    {row.quantity} portions, {row.reason.replaceAll("_", " ").toLowerCase()}. Source {row.source}.
                  </p>
                </div>
                <span className="mgr-badges">
                  <span className="mgr-badge is-bad">{row.quantity} discarded</span>
                  <span className="mgr-badge">{reasonLabel(row.reason)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}
