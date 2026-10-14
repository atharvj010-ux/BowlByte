"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch, readError } from "@/lib/auth";
import { overviewSchema } from "@/lib/kitchen";

export function KitchenOverview() {
  const overview = useQuery({
    queryKey: ["kitchen-overview"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/admin/kitchen/overview");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return overviewSchema.parse(await response.json());
    },
  });
  if (overview.isLoading) {
    return <p>Loading kitchen activity.</p>;
  }
  if (overview.isError) {
    return <p className="text-sm text-destructive">{overview.error.message}</p>;
  }
  const data = overview.data;
  if (!data) {
    return <p>Loading kitchen activity.</p>;
  }
  const observed =
    data.average_observed_prep_seconds === null
      ? "No completed preparations yet"
      : `${Math.round(data.average_observed_prep_seconds / 60)} min average observed preparation`;
  const wait =
    data.average_queue_wait_seconds === null
      ? "No observed queue wait yet"
      : `${Math.round(data.average_queue_wait_seconds / 60)} min average observed wait before preparation`;
  return (
    <section className="space-y-4" aria-labelledby="kitchen-overview">
      <h2 id="kitchen-overview" className="font-display text-3xl">
        Kitchen activity
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Incoming" value={data.placed} />
        <Stat label="Waiting" value={data.waiting} />
        <Stat label="Preparing" value={data.preparing} />
        <Stat label="Ready" value={data.ready} />
      </dl>
      <p className="text-sm">{observed}</p>
      <p className="text-sm">{wait}</p>
      <p className="text-sm">{data.delayed_orders} orders are past the estimated window or marked running long.</p>
      <p className="text-sm text-muted-foreground">{data.notes.observed}</p>
      <p className="text-sm text-muted-foreground">{data.notes.estimated}</p>
      <p className="text-sm text-muted-foreground">{data.notes.cash_collected}</p>
      <ul className="grid gap-3 md:grid-cols-3">
        {data.stations.map((station) => (
          <li key={station.id} className="rounded-2xl border border-border p-4 text-sm">
            <p className="font-medium">{station.name}</p>
            <p>
              {station.in_progress}/{station.parallel_capacity} preparing · {station.waiting} waiting
            </p>
            <p>Estimated backlog {Math.ceil(station.backlog_seconds / 60)} min</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-display text-3xl">{value}</dd>
    </div>
  );
}
