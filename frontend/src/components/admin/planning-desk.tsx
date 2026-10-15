"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { fieldClass, managerCanDecide, planSchema } from "@/lib/intelligence";

const stationSchema = z.object({
  id: z.string(),
  name: z.string(),
  parallel_capacity: z.number().int(),
  is_active: z.boolean(),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PlanningDesk({ role }: { role: string }) {
  const [day, setDay] = useState(today());
  const [factor, setFactor] = useState("1.2");
  const [stationId, setStationId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<z.infer<typeof planSchema> & { id?: string; status?: string } | null>(null);
  const [simulation, setSimulation] = useState<z.infer<typeof planSchema> | null>(null);
  const stations = useQuery({
    queryKey: ["admin-stations"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/admin/stations");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return z.array(stationSchema).parse(await response.json());
    },
  });
  const canDecide = managerCanDecide(role);

  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/v1/admin/planning/generate", {
        method: "POST",
        body: JSON.stringify({ service_date: day, idempotency_key: newKey() }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      const payload = planSchema.parse(await response.json());
      setPlan(payload);
      setMessage("Draft saved. Approving it does not cook food or change stock.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    if (!plan?.id) {
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(`/api/v1/admin/planning/${plan.id}/${approve ? "approve" : "reject"}`, {
        method: "POST",
        body: JSON.stringify({ reason: approve ? "Manager accepted the draft." : "Manager rejected the draft." }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      const payload = planSchema.parse(await response.json());
      setPlan(payload);
      setMessage(approve ? "Plan approved as an intention only." : "Plan rejected.");
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/v1/admin/planning/simulate", {
        method: "POST",
        body: JSON.stringify({
          service_date: day,
          demand_factor: Number(factor),
          inactive_station_ids: stationId ? [stationId] : [],
        }),
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      const payload = planSchema.parse(await response.json());
      setSimulation(payload);
      setMessage(payload.label ?? "Estimate.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" data-testid="planning-desk">
      <div>
        <h1 className="font-display text-4xl">Preparation planning</h1>
        <p className="text-sm text-muted-foreground">
          A recommendation is a quantity to consider. It does not create a production batch.
        </p>
      </div>
      <label className="grid max-w-xs gap-1 text-sm">
        Service date
        <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={fieldClass} data-testid="plan-date" />
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={busy || !canDecide} onClick={generate} data-testid="plan-generate">
          Generate recommendation
        </Button>
        <Button type="button" variant="secondary" disabled={busy || !plan?.id || !canDecide} onClick={() => decide(true)} data-testid="plan-approve">
          Approve plan
        </Button>
      </div>
      {message ? <p data-testid="plan-notice">{message}</p> : null}
      {plan?.status ? <p data-testid="plan-status">Status {plan.status}. Solver {plan.solver}.</p> : null}
      <PlanList rows={plan?.items ?? []} testId="plan-items" />
      <div className="rounded-2xl border border-border p-4" data-testid="what-if">
        <h2 className="font-display text-2xl">What-if</h2>
        <p className="text-sm text-muted-foreground">Estimates only. Stock and orders stay as they are.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            Demand factor
            <input value={factor} onChange={(event) => setFactor(event.target.value)} className={fieldClass} data-testid="demand-factor" />
          </label>
          <label className="grid gap-1 text-sm">
            Station treated as unavailable
            <select value={stationId} onChange={(event) => setStationId(event.target.value)} className={fieldClass} data-testid="simulate-station">
              <option value="">None</option>
              {stations.data?.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" disabled={busy} onClick={simulate} data-testid="simulate-run">
            Compare scenario
          </Button>
        </div>
        {simulation?.label ? <p data-testid="simulate-label">{simulation.label}</p> : null}
        <PlanList rows={simulation?.items ?? []} testId="simulate-items" />
      </div>
    </section>
  );
}

function PlanList({ rows, testId }: { rows: z.infer<typeof planSchema>["items"]; testId: string }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-3" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.menu_item_id} className="rounded-2xl border border-border p-4 text-sm">
          <p>
            Recommend {row.recommended_additional_qty} more. Feasible {row.feasible_qty}. Unmet {row.unmet_qty}.
            {row.capacity_limited ? " Capacity limited." : ""}
          </p>
          <p>Forecast {row.forecast_qty ?? "none"}. Confirmed {row.confirmed_unfulfilled_qty}. Usable {row.usable_prepared_qty}. Scheduled {row.scheduled_qty}.</p>
          <p>{row.explanation}</p>
        </li>
      ))}
    </ul>
  );
}
