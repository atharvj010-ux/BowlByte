"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { EmptyState, Notice, PageHead, Panel, SkeletonLines } from "@/components/admin/admin-ui";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { emptyHistoryCopy, sourceBadge } from "@/lib/intelligence";
import { cn } from "@/lib/utils";

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

const SHOWN = 40;

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
    placeholderData: keepPreviousData,
  });
  const badge = sourceBadge(source);
  const rows = history.data?.rows ?? [];
  return (
    <section className="grid gap-4" data-testid="history-desk">
      <PageHead
        kicker="Insight · per dish per day"
        title="Demand history"
        description={badge.note}
        actions={
          <a
            className="mgr-cta"
            href={`/api/v1/admin/intelligence/demand-history?date_from=${from}&date_to=${to}&source=${source}&export=csv`}
          >
            Download CSV
          </a>
        }
      />
      <div className="mgr-toolbar">
        <label className="mgr-field">
          <span>Source</span>
          <select value={source} onChange={(event) => setSource(event.target.value as "REAL" | "DEMO")} className={textInputClass} data-testid="history-source">
            <option value="REAL">Recorded</option>
            <option value="DEMO">Demo</option>
          </select>
        </label>
        <label className="mgr-field">
          <span>From</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={textInputClass} />
        </label>
        <label className="mgr-field">
          <span>To</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={textInputClass} />
        </label>
      </div>
      <Panel
        title="Rows"
        subtitle={
          history.data
            ? rows.length > SHOWN
              ? `Showing the first ${SHOWN} of ${rows.length}. Download the CSV for everything.`
              : `${rows.length} rows`
            : "Loading history"
        }
        action={<span className={cn("mgr-badge", source === "DEMO" ? "is-info" : "is-good")}>{badge.label}</span>}
      >
        {history.isLoading ? (
          <>
            <p className="sr-only">Loading history.</p>
            <SkeletonLines count={4} />
          </>
        ) : null}
        {history.isError ? <Notice tone="error">{history.error.message}</Notice> : null}
        {history.data && rows.length === 0 ? <EmptyState>{emptyHistoryCopy(source)}</EmptyState> : null}
        {rows.length > 0 ? (
          <div className={cn("mgr-table-wrap", history.isPlaceholderData && "is-stale")}>
            <table className="mgr-table" data-testid="history-rows">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Dish</th>
                  <th scope="col">Quality</th>
                  <th scope="col" className="is-num">
                    Observed
                  </th>
                  <th scope="col" className="is-num">
                    Prepared
                  </th>
                  <th scope="col" className="is-num">
                    Discarded
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOWN).map((row) => (
                  <tr key={`${row.menu_item_id}-${row.service_date}`}>
                    <td className="whitespace-nowrap">{row.service_date}</td>
                    <td>{row.item_name}</td>
                    <td>
                      <span className={cn("mgr-badge", row.quality === "OBSERVED" ? "is-good" : "is-warn")}>
                        {row.quality.replaceAll("_", " ").toLowerCase()}
                      </span>
                    </td>
                    <td className="is-num">{row.observed_demand_qty}</td>
                    <td className="is-num">{row.produced_qty}</td>
                    <td className="is-num">{row.discarded_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}
