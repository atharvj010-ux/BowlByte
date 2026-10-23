"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { EmptyState, Notice, PageHead, Panel, SkeletonLines } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { batchListSchema } from "@/lib/intelligence";
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
  const [failed, setFailed] = useState(false);
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
    setFailed(false);
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
        setFailed(true);
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
  const list = batches.data?.batches ?? [];
  const totalProduced = list.reduce((sum, batch) => sum + batch.produced_qty, 0);
  return (
    <section className="grid gap-4" data-testid="production-desk">
      <PageHead
        kicker="Kitchen ledger"
        title="Production"
        description="Portions the kitchen prepared. This ledger is separate from saleable stock and from online orders."
      />
      <div className="mgr-split">
        <Panel title="Record a batch" subtitle="Log what came off the line." tone="#f6d15a">
          <form className="mgr-form" onSubmit={save} data-testid="production-form">
            <label className="mgr-field">
              <span>Date</span>
              <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={textInputClass} data-testid="production-date" />
            </label>
            <label className="mgr-field">
              <span>Find item</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} className={textInputClass} placeholder="Type to narrow the list" data-testid="production-search" />
            </label>
            <label className="mgr-field">
              <span>Item</span>
              <select value={itemId} onChange={(event) => setItemId(event.target.value)} className={textInputClass} data-testid="production-item" required>
                <option value="">Choose an item</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mgr-field">
              <span>Portions prepared</span>
              <input type="number" min={1} max={5000} value={quantity} onChange={(event) => setQuantity(event.target.value)} className={textInputClass} data-testid="production-qty" required />
            </label>
            <label className="mgr-field">
              <span>Notes</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className={textInputClass} maxLength={400} />
            </label>
            <Button type="submit" disabled={busy || !itemId} data-testid="production-save">
              Record batch
            </Button>
          </form>
          {message ? (
            <p className={failed ? "mgr-notice is-error" : "mgr-notice is-success"} role="status" data-testid="production-notice">
              {message}
            </p>
          ) : null}
        </Panel>

        <div className="mgr-stack">
          <Panel
            title="Batches"
            subtitle={batches.data ? `${list.length} batches · ${totalProduced} portions on ${day}` : `Loading ${day}`}
          >
            {batches.isLoading ? (
              <>
                <p className="sr-only">Loading batches.</p>
                <SkeletonLines count={2} />
              </>
            ) : null}
            {batches.isError ? <Notice tone="error">{batches.error.message}</Notice> : null}
            {batches.data && list.length === 0 ? <EmptyState>No batches on this date.</EmptyState> : null}
            <ul className="mgr-list" data-testid="production-list">
              {list.map((batch) => (
                <li key={batch.id} className="mgr-list-row items-start">
                  <div className="grid min-w-0 gap-1">
                    <p className="mgr-row-title">
                      {batch.batch_code} · {batch.item_name}
                    </p>
                    <p className="mgr-row-meta">
                      Produced {batch.produced_qty}, counter served {batch.served_counter_qty}, remaining{" "}
                      {batch.remaining_qty}, discarded {batch.discarded_qty}. {batch.equation}
                    </p>
                  </div>
                  <span className="mgr-badge is-warn">{batch.produced_qty} made</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Reconciliation" subtitle={reconciliation.data?.note} testId="reconciliation">
            {reconciliation.isError ? <Notice tone="error">{reconciliation.error.message}</Notice> : null}
            {reconciliation.data && reconciliation.data.items.length === 0 ? (
              <EmptyState>Nothing to reconcile on this date.</EmptyState>
            ) : null}
            {reconciliation.data && reconciliation.data.items.length > 0 ? (
              <div className="mgr-table-wrap">
                <table className="mgr-table">
                  <thead>
                    <tr>
                      <th scope="col">Dish</th>
                      <th scope="col" className="is-num">
                        Produced
                      </th>
                      <th scope="col" className="is-num">
                        Counter
                      </th>
                      <th scope="col" className="is-num">
                        Online
                      </th>
                      <th scope="col" className="is-num">
                        Remaining
                      </th>
                      <th scope="col" className="is-num">
                        Discarded
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.data.items.map((row) => (
                      <tr key={row.item_name}>
                        <td>
                          {row.item_name}
                          {row.warnings.map((warning) => (
                            <span key={warning} className="mgr-cell-sub">
                              {warning}
                            </span>
                          ))}
                        </td>
                        <td className="is-num">{row.produced}</td>
                        <td className="is-num">{row.served_counter}</td>
                        <td className="is-num">{row.online_picked_up}</td>
                        <td className="is-num">{row.remaining}</td>
                        <td className="is-num">{row.discarded}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </section>
  );
}
