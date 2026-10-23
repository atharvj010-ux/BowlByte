"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { PageHead, Panel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { managerCanDecide, planSchema } from "@/lib/intelligence";
import { cn } from "@/lib/utils";

const stationSchema = z.object({
  id: z.string(),
  name: z.string(),
  parallel_capacity: z.number().int(),
  is_active: z.boolean(),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusTone(status: string | undefined): string {
  if (status === "APPROVED") {
    return "is-good";
  }
  if (status === "REJECTED") {
    return "is-bad";
  }
  return "is-warn";
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
    <section className="grid gap-4" data-testid="planning-desk">
      <PageHead
        kicker="Insight · what to cook"
        title="Preparation planning"
        description="A recommendation is a quantity to consider. It does not create a production batch."
      />
      <Panel title="Recommendation" subtitle="Generate a draft for a service day, then approve it as the plan of record." tone="#f6d15a">
        <div className="mgr-toolbar">
          <label className="mgr-field">
            <span>Service date</span>
            <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={textInputClass} data-testid="plan-date" />
          </label>
          <Button type="button" disabled={busy || !canDecide} onClick={generate} data-testid="plan-generate">
            Generate recommendation
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !plan?.id || !canDecide}
            onClick={() => decide(true)}
            data-testid="plan-approve"
          >
            Approve plan
          </Button>
        </div>
        {message ? (
          <p className="mgr-notice" role="status" data-testid="plan-notice">
            {message}
          </p>
        ) : null}
        {plan?.status ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="plan-status">
            <span className={cn("mgr-badge", statusTone(plan.status))}>{plan.status}</span>
            Status {plan.status}. Solver {plan.solver}.
          </p>
        ) : null}
        <PlanList rows={plan?.items ?? []} testId="plan-items" />
      </Panel>

      <Panel title="What-if" subtitle="Estimates only. Stock and orders stay as they are." testId="what-if">
        <div className="mgr-toolbar">
          <label className="mgr-field">
            <span>Demand factor</span>
            <input value={factor} onChange={(event) => setFactor(event.target.value)} className={textInputClass} inputMode="decimal" data-testid="demand-factor" />
          </label>
          <label className="mgr-field">
            <span>Station treated as unavailable</span>
            <select value={stationId} onChange={(event) => setStationId(event.target.value)} className={textInputClass} data-testid="simulate-station">
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
        {simulation?.label ? (
          <p className="mgr-notice" data-testid="simulate-label">
            {simulation.label}
          </p>
        ) : null}
        <PlanList rows={simulation?.items ?? []} testId="simulate-items" />
      </Panel>
    </section>
  );
}

function PlanList({ rows, testId }: { rows: z.infer<typeof planSchema>["items"]; testId: string }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <ul className="mgr-list" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.menu_item_id} className="mgr-list-row items-start text-sm">
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="mgr-row-title">
              Recommend {row.recommended_additional_qty} more. Feasible {row.feasible_qty}. Unmet {row.unmet_qty}.
              {row.capacity_limited ? " Capacity limited." : ""}
            </p>
            <p className="mgr-row-meta">
              Forecast {row.forecast_qty ?? "none"}. Confirmed {row.confirmed_unfulfilled_qty}. Usable{" "}
              {row.usable_prepared_qty}. Scheduled {row.scheduled_qty}.
            </p>
            <p className="mgr-row-meta">{row.explanation}</p>
          </div>
          {row.capacity_limited ? <span className="mgr-badge is-warn">Capacity limited</span> : null}
        </li>
      ))}
    </ul>
  );
}
