"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, Notice, Panel, Segmented, SkeletonLines, StatGrid, StatTile } from "@/components/admin/admin-ui";
import { apiFetch, readError } from "@/lib/auth";
import { overviewSchema } from "@/lib/kitchen";
import { cn } from "@/lib/utils";

function minutesText(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  const mins = Math.round(seconds / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function KitchenOverview() {
  const [show, setShow] = useState<"busy" | "all">("busy");
  const overview = useQuery({
    queryKey: ["kitchen-overview"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/admin/kitchen/overview");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return overviewSchema.parse(await response.json());
    },
    refetchInterval: 15_000,
  });
  if (overview.isLoading) {
    return (
      <div className="grid gap-4">
        <p className="sr-only">Loading kitchen activity.</p>
        <SkeletonLines count={4} />
      </div>
    );
  }
  if (overview.isError) {
    return <Notice tone="error">{overview.error.message}</Notice>;
  }
  const data = overview.data;
  if (!data) {
    return <p className="mgr-empty">Loading kitchen activity.</p>;
  }
  const observed =
    data.average_observed_prep_seconds === null
      ? "No completed preparations yet"
      : `${Math.round(data.average_observed_prep_seconds / 60)} min average observed preparation`;
  const wait =
    data.average_queue_wait_seconds === null
      ? "No observed queue wait yet"
      : `${Math.round(data.average_queue_wait_seconds / 60)} min average observed wait before preparation`;
  const sorted = [...data.stations].sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) ||
      b.in_progress + b.waiting - (a.in_progress + a.waiting) ||
      b.backlog_seconds - a.backlog_seconds ||
      a.name.localeCompare(b.name),
  );
  const busy = sorted.filter((station) => station.in_progress + station.waiting > 0);
  const stations = show === "busy" ? busy : sorted;
  return (
    <section className="grid gap-4" aria-labelledby="kitchen-overview">
      <h2 id="kitchen-overview" className="sr-only">
        Kitchen activity
      </h2>
      <StatGrid label="Orders by stage">
        <StatTile label="Incoming" value={data.placed} note="Placed, not yet accepted" tone="#4aa8ff" />
        <StatTile label="Waiting" value={data.waiting} note="Accepted, in the queue" tone="#f6d15a" />
        <StatTile label="Preparing" value={data.preparing} note="On a station now" tone="#ff5c8a" />
        <StatTile label="Ready" value={data.ready} note="Waiting at the counter" tone="#3df28b" />
        <StatTile
          label="Running late"
          value={data.delayed_orders}
          note={`${data.delayed_orders} orders are past the estimated window or marked running long.`}
          tone={data.delayed_orders > 0 ? "#ff5c8a" : "#8a8494"}
        />
      </StatGrid>

      <div className="mgr-split is-even">
        <Panel title="Timing" subtitle="Measured from completed work, not promises.">
          <StatGrid>
            <StatTile label="Average preparation" value={minutesText(data.average_observed_prep_seconds)} note={observed} tone="#ff5c8a" />
            <StatTile label="Average queue wait" value={minutesText(data.average_queue_wait_seconds)} note={wait} tone="#f6d15a" />
          </StatGrid>
        </Panel>
        <Panel title="How to read this">
          <ul className="mgr-footnotes border-t-0 pt-0">
            <li>{data.notes.observed}</li>
            <li>{data.notes.estimated}</li>
            <li>{data.notes.cash_collected}</li>
          </ul>
        </Panel>
      </div>

      <Panel
        title="Stations"
        subtitle={`${data.stations.filter((station) => station.is_active).length} active · ${busy.length} working right now`}
        action={
          <Segmented<"busy" | "all">
            label="Show stations"
            value={show}
            onChange={setShow}
            options={[
              { value: "busy", label: "Working", count: busy.length },
              { value: "all", label: "All", count: data.stations.length },
            ]}
          />
        }
      >
        {stations.length === 0 ? (
          <EmptyState>
            {show === "busy" ? "No station is cooking or has a queue right now." : "No stations have been set up yet."}
          </EmptyState>
        ) : null}
        <ul className="mgr-station-grid">
          {stations.map((station) => {
            const load = station.parallel_capacity
              ? Math.min(100, (station.in_progress / station.parallel_capacity) * 100)
              : 0;
            return (
              <li key={station.id} className={cn("mgr-station-card text-sm", !station.is_active && "is-dim")}>
                <div className="flex items-start justify-between gap-2">
                  <p className="mgr-row-title">{station.name}</p>
                  {station.is_active ? null : <span className="mgr-badge is-bad">Paused</span>}
                </div>
                <p>
                  {station.in_progress}/{station.parallel_capacity} preparing · {station.waiting} waiting
                </p>
                <div className="mgr-meter">
                  <span style={{ width: `${load}%` }} />
                </div>
                <p className="mgr-row-meta">Estimated backlog {Math.ceil(station.backlog_seconds / 60)} min</p>
              </li>
            );
          })}
        </ul>
      </Panel>
    </section>
  );
}
