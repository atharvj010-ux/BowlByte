"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { EmptyState, Notice, PageHead, Panel, SkeletonLines } from "@/components/admin/admin-ui";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { barPercent, formatRatio, overviewSchema, sourceBadge } from "@/lib/intelligence";
import { cn } from "@/lib/utils";

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
    placeholderData: keepPreviousData,
  });
  const data = overview.data;
  const badge = sourceBadge(data?.source ?? "REAL");
  const max = Math.max(1, ...(data?.by_day.map((row) => Math.max(row.ordered, row.produced, row.discarded)) ?? [1]));
  const topMax = Math.max(1, ...(data?.top_items.map((item) => item.qty_ordered) ?? [1]));
  return (
    <section className="grid gap-4" data-testid="intelligence-overview">
      <PageHead
        kicker="Insight · recorded data"
        title="Food intelligence"
        description="Recorded orders, production, and discards. Forecasts live on their own page and are not shown here as actual demand."
      />
      <form className="mgr-toolbar" onSubmit={(event) => event.preventDefault()}>
        <label className="mgr-field">
          <span>From</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={textInputClass} data-testid="overview-from" />
        </label>
        <label className="mgr-field">
          <span>To</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={textInputClass} data-testid="overview-to" />
        </label>
      </form>
      {overview.isLoading ? (
        <>
          <p className="sr-only">Loading recorded totals.</p>
          <SkeletonLines count={3} />
        </>
      ) : null}
      {overview.isError ? <Notice tone="error">{overview.error.message}</Notice> : null}
      {data ? (
        <>
          <p className="mgr-notice" data-testid="source-badge">
            <span className="mgr-badge is-info mr-2">{badge.label}</span>
            {badge.note}
          </p>
          <dl className={cn("mgr-stats", overview.isPlaceholderData && "is-stale")}>
            <Stat id="orders" label="Orders placed" value={String(data.orders)} tone="#4aa8ff" />
            <Stat id="picked-up" label="Picked-up portions" value={String(data.picked_up_portions)} tone="#3df28b" />
            <Stat id="produced" label="Prepared portions" value={String(data.produced_portions)} tone="#f6d15a" />
            <Stat id="discarded" label="Recorded discards" value={String(data.discarded_portions)} tone="#ff8d7a" />
            <Stat id="waste-ratio" label="Waste percentage" value={formatRatio(data.waste_ratio)} tone="#ff5c8a" />
            <Stat id="cash" label="Cash recorded" value={formatInrFromPaise(data.cash_recorded_paise)} tone="#d5f25b" />
            <Stat id="model" label="Active forecast model" value={data.active_model ? data.active_model.algorithm : "None"} tone="#8cc8ff" />
            <Stat id="quality" label="Data quality" value={`${data.data_quality.observed_rows} observed`} tone="#6ff5a8" />
          </dl>
          <ul className="mgr-footnotes">
            <li>{data.cash_note}</li>
            <li>
              Cancelled {data.cancelled_portions} portions. Rejected {data.rejected_portions}. Censored rows{" "}
              {data.data_quality.censored_rows}. Closed rows {data.data_quality.closed_rows}.
            </li>
          </ul>
          <div className="mgr-split">
            <Panel title="Top dishes" subtitle="Portions ordered in this range.">
              {data.top_items.length === 0 ? <EmptyState>No orders in this range.</EmptyState> : null}
              <ul className="mgr-hbars">
                {data.top_items.map((item, index) => (
                  <li key={item.name} className="mgr-hbar">
                    <span className="mgr-hbar-name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="mgr-hbar-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${barPercent(item.qty_ordered, topMax)}%`,
                          ["--tone" as string]: ["#4aa8ff", "#ff5c8a", "#f6d15a", "#3df28b", "#f15438"][index % 5],
                        }}
                      />
                    </span>
                    <span className="mgr-hbar-value" aria-label={`${item.qty_ordered} ordered`}>
                      {item.qty_ordered}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Daily recorded quantities" subtitle="Ordered, prepared, and discarded portions per service day.">
              <div className="grid gap-3" aria-label="Daily recorded quantities">
                {data.by_day.length === 0 ? <EmptyState>No recorded rows in this range.</EmptyState> : null}
                {data.by_day.map((row) => (
                  <div key={row.service_date} className="mgr-day">
                    <p className="mgr-day-date">{row.service_date}</p>
                    <Bar label="Ordered" value={row.ordered} width={barPercent(row.ordered, max)} tone="#4aa8ff" />
                    <Bar label="Prepared" value={row.produced} width={barPercent(row.produced, max)} tone="#f6d15a" />
                    <Bar label="Discarded" value={row.discarded} width={barPercent(row.discarded, max)} tone="#ff8d7a" />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Stat({ id, label, value, tone }: { id: string; label: string; value: string; tone: string }) {
  return (
    <div className="mgr-stat" style={{ ["--tone" as string]: tone }} data-testid={id}>
      <dt className="mgr-stat-label">{label}</dt>
      <dd className="mgr-stat-value">{value}</dd>
    </div>
  );
}

function Bar({ label, value, width, tone }: { label: string; value: number; width: number; tone: string }) {
  return (
    <div className="mgr-hbar">
      <span className="mgr-hbar-name">{label}</span>
      <span className="mgr-hbar-track" role="img" aria-label={`${label} ${value}`}>
        <span style={{ width: `${width}%`, ["--tone" as string]: tone }} />
      </span>
      <span className="mgr-hbar-value">{value}</span>
    </div>
  );
}
