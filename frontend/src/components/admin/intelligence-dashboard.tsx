"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { barPercent, fieldClass, formatRatio, overviewSchema, sourceBadge } from "@/lib/intelligence";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function IntelligenceDashboard() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const overview = useQuery({
    queryKey: ["intelligence-overview", from, to],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/admin/intelligence/overview?date_from=${from}&date_to=${to}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return overviewSchema.parse(await response.json());
    },
  });
  const data = overview.data;
  const badge = sourceBadge(data?.source ?? "REAL");
  const max = Math.max(1, ...(data?.by_day.map((row) => Math.max(row.ordered, row.produced, row.discarded)) ?? [1]));
  return (
    <section className="space-y-6" data-testid="intelligence-overview">
      <div>
        <h1 className="font-display text-4xl">Food intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Recorded orders, production, and discards. Forecasts live on their own page and are not shown here as actual demand.
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => event.preventDefault()}>
        <label className="grid gap-1 text-sm">
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={fieldClass} data-testid="overview-from" />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={fieldClass} data-testid="overview-to" />
        </label>
      </form>
      {overview.isLoading ? <p>Loading recorded totals.</p> : null}
      {overview.isError ? <p role="alert">{overview.error.message}</p> : null}
      {data ? (
        <>
          <p data-testid="source-badge">
            {badge.label}. {badge.note}
          </p>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat id="orders" label="Orders placed" value={String(data.orders)} />
            <Stat id="picked-up" label="Picked-up portions" value={String(data.picked_up_portions)} />
            <Stat id="produced" label="Prepared portions" value={String(data.produced_portions)} />
            <Stat id="discarded" label="Recorded discards" value={String(data.discarded_portions)} />
            <Stat id="waste-ratio" label="Waste percentage" value={formatRatio(data.waste_ratio)} />
            <Stat id="cash" label="Cash recorded" value={formatInrFromPaise(data.cash_recorded_paise)} />
            <Stat id="model" label="Active forecast model" value={data.active_model ? data.active_model.algorithm : "None"} />
            <Stat
              id="quality"
              label="Data quality"
              value={`${data.data_quality.observed_rows} observed`}
            />
          </dl>
          <p className="text-sm text-muted-foreground">{data.cash_note}</p>
          <p className="text-sm">
            Cancelled {data.cancelled_portions} portions. Rejected {data.rejected_portions}. Censored rows {data.data_quality.censored_rows}. Closed rows {data.data_quality.closed_rows}.
          </p>
          <div className="space-y-3" aria-label="Daily recorded quantities">
            {data.by_day.length === 0 ? <p>No recorded rows in this range.</p> : null}
            {data.by_day.map((row) => (
              <div key={row.service_date}>
                <p className="text-sm">{row.service_date}</p>
                <Bar label="Ordered" value={row.ordered} width={barPercent(row.ordered, max)} />
                <Bar label="Prepared" value={row.produced} width={barPercent(row.produced, max)} />
                <Bar label="Discarded" value={row.discarded} width={barPercent(row.discarded, max)} />
              </div>
            ))}
          </div>
          <ul>
            {data.top_items.map((item) => (
              <li key={item.name}>
                {item.name}: {item.qty_ordered} ordered
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Stat({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border p-4" data-testid={id}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl">{value}</dd>
    </div>
  );
}

function Bar({ label, value, width }: { label: string; value: number; width: number }) {
  return (
    <div className="mt-1 grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <div className="h-2 rounded-full bg-muted" role="img" aria-label={`${label} ${value}`}>
        <div className="h-2 rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span>{value}</span>
    </div>
  );
}
