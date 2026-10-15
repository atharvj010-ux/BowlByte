"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch, readError } from "@/lib/auth";
import { emptyHistoryCopy, fieldClass, sourceBadge } from "@/lib/intelligence";

const rowSchema = z.object({
  service_date: z.string(),
  menu_item_id: z.string(),
  item_name: z.string(),
  quality: z.string(),
  observed_demand_qty: z.number().int(),
  produced_qty: z.number().int(),
  discarded_qty: z.number().int(),
  source: z.string(),
});

export function HistoryDesk() {
  const [source, setSource] = useState<"REAL" | "DEMO">("REAL");
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 13);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const history = useQuery({
    queryKey: ["demand-history", source, from, to],
    queryFn: async () => {
      const response = await apiFetch(
        `/api/v1/admin/intelligence/demand-history?date_from=${from}&date_to=${to}&source=${source}`,
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return z.object({ rows: z.array(rowSchema), source: z.string() }).parse(await response.json());
    },
  });
  const badge = sourceBadge(source);
  return (
    <section className="space-y-6" data-testid="history-desk">
      <div>
        <h1 className="font-display text-4xl">Demand history</h1>
        <p className="text-sm text-muted-foreground">{badge.note}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Source
          <select value={source} onChange={(event) => setSource(event.target.value as "REAL" | "DEMO")} className={fieldClass} data-testid="history-source">
            <option value="REAL">Recorded</option>
            <option value="DEMO">Demo</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={fieldClass} />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={fieldClass} />
        </label>
        <a
          className="underline"
          href={`/api/v1/admin/intelligence/demand-history?date_from=${from}&date_to=${to}&source=${source}&export=csv`}
        >
          Download CSV
        </a>
      </div>
      {history.isLoading ? <p>Loading history.</p> : null}
      {history.isError ? <p role="alert">{history.error.message}</p> : null}
      {history.data && history.data.rows.length === 0 ? <p>{emptyHistoryCopy(source)}</p> : null}
      <ul className="space-y-2 text-sm" data-testid="history-rows">
        {history.data?.rows.slice(0, 40).map((row) => (
          <li key={`${row.menu_item_id}-${row.service_date}`}>
            {row.service_date} · {row.item_name} · {row.quality} · observed {row.observed_demand_qty} · prepared {row.produced_qty} · discarded {row.discarded_qty}
          </li>
        ))}
      </ul>
    </section>
  );
}
