"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { EmptyState, Notice, PageHead, Panel, SkeletonLines } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { forecastRunSchema, formatMetric, modelSchema, rangeText, sourceBadge } from "@/lib/intelligence";
import { cn } from "@/lib/utils";

const jobSchema = z.object({
  id: z.string(),
  status: z.string(),
  source: z.string(),
  error: z.string().nullable(),
});

export function ForecastDesk() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<z.infer<typeof forecastRunSchema> | null>(null);
  const models = useQuery({
    queryKey: ["forecast-models"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/admin/forecasts/models");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return z.object({ models: z.array(modelSchema) }).parse(await response.json());
    },
  });

  async function post(path: string, body: unknown) {
    const response = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    return response.json();
  }

  async function loadDemo() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await post("/api/v1/admin/intelligence/demo-dataset", { days: 60, seed: 7 });
      setMessage(String(payload.note ?? "Demo history loaded."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Demo history failed.");
    } finally {
      setBusy(false);
    }
  }

  async function train(source: "DEMO" | "REAL") {
    setBusy(true);
    setMessage("");
    try {
      const created = jobSchema.parse(
        await post("/api/v1/admin/forecasting/train", { source, idempotency_key: newKey() }),
      );
      let status = created.status;
      for (let attempt = 0; attempt < 40 && (status === "PENDING" || status === "RUNNING"); attempt += 1) {
        setMessage(`Training ${status.toLowerCase()} on ${source === "DEMO" ? "demo" : "recorded"} history…`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const response = await apiFetch(`/api/v1/admin/forecasting/jobs/${created.id}`);
        const job = jobSchema.parse(await response.json());
        status = job.status;
        if (job.error) {
          setMessage(job.error);
        }
      }
      setMessage(`Training ${status}. Source ${source}.`);
      await queryClient.invalidateQueries({ queryKey: ["forecast-models"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Training failed.");
    } finally {
      setBusy(false);
    }
  }

  async function generate(source: "DEMO" | "REAL") {
    setBusy(true);
    setMessage("");
    try {
      const payload = forecastRunSchema.parse(
        await post("/api/v1/admin/forecasts/generate", {
          source,
          horizon_days: 7,
          idempotency_key: newKey(),
        }),
      );
      setRun(payload);
      setMessage(`${payload.status}. ${payload.limitations}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Forecast failed.");
    } finally {
      setBusy(false);
    }
  }

  const list = models.data?.models ?? [];
  return (
    <section className="grid gap-4" data-testid="forecast-desk">
      <PageHead
        kicker="Insight · next 7 days"
        title="Forecasts"
        description="Expected portions per item per upcoming open day. A prediction is not a recorded sale."
      />
      <div className="mgr-split is-even">
        <Panel title="Practice with demo data" subtitle="Seeded history, clearly labelled DEMO. Safe to try anytime." tone="#8cc8ff">
          <div className="mgr-actions">
            <Button type="button" variant="outline" disabled={busy} onClick={loadDemo} data-testid="load-demo">
              Load demo history
            </Button>
            <Button type="button" disabled={busy} onClick={() => train("DEMO")} data-testid="train-demo">
              Train on demo history
            </Button>
            <Button type="button" disabled={busy} onClick={() => generate("DEMO")} data-testid="forecast-demo">
              Forecast from demo
            </Button>
          </div>
        </Panel>
        <Panel title="Use recorded history" subtitle="Real orders from this canteen. Needs enough days to be useful." tone="#3df28b">
          <div className="mgr-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => train("REAL")} data-testid="train-real">
              Train on recorded history
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => generate("REAL")} data-testid="forecast-real">
              Forecast from recorded history
            </Button>
          </div>
        </Panel>
      </div>
      {message ? (
        <p className="mgr-notice" role="status" data-testid="forecast-notice">
          {message}
        </p>
      ) : null}

      {run ? (
        <Panel
          title="Latest forecast"
          subtitle={`${run.status} · ${run.method} · ${sourceBadge(run.source).label} · cutoff ${run.data_cutoff}`}
          testId="forecast-result"
        >
          <p className="mgr-card-sub">{run.limitations}</p>
          {run.values && run.values.length > 0 ? (
            <div className="mgr-table-wrap">
              <table className="mgr-table is-compact">
                <thead>
                  <tr>
                    <th scope="col">Service date</th>
                    <th scope="col" className="is-num">
                      Portions
                    </th>
                    <th scope="col">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {run.values.map((value) => (
                    <tr key={`${value.menu_item_id}-${value.service_date}`}>
                      <td>{value.service_date}</td>
                      <td className="is-num">{value.predicted_qty ?? "insufficient"}</td>
                      <td className="mgr-cell-sub">{rangeText(value.range_kind, value.lower_qty, value.upper_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No forecast values were produced.</EmptyState>
          )}
        </Panel>
      ) : null}

      <Panel title="Trained models" subtitle="The preferred model is used for new forecasts.">
        {models.isLoading ? <SkeletonLines count={2} /> : null}
        {models.isError ? <Notice tone="error">{models.error.message}</Notice> : null}
        {models.data && list.length === 0 ? <EmptyState>No model has been trained.</EmptyState> : null}
        <ul className="mgr-list" data-testid="model-list">
          {list.map((model) => {
            const badge = sourceBadge(model.source);
            const holdout = model.evaluations.find((row) => row.role === "HOLDOUT");
            return (
              <li key={model.id} className="mgr-list-row items-start text-sm" data-testid="model-card">
                <div className="grid min-w-0 gap-1">
                  <p className="mgr-row-title">
                    {model.algorithm} · {model.status} · {badge.label}
                    {model.recommended ? " · preferred" : ""}
                  </p>
                  <p className="mgr-row-meta">{model.selection_reason}</p>
                  <p className="mgr-row-meta">Cutoff {model.training_cutoff}</p>
                  {holdout ? (
                    <p className="mgr-row-meta">
                      Holdout MAE {formatMetric(holdout.mae)}, WAPE {formatMetric(holdout.wape)}, bias{" "}
                      {formatMetric(holdout.bias)}, {holdout.n_points} points. This score is for {badge.label} data only.
                    </p>
                  ) : (
                    <p className="mgr-row-meta">No holdout score. The model was not evaluated on a separate period.</p>
                  )}
                </div>
                <span className="mgr-badges">
                  <span className={cn("mgr-badge", model.source === "DEMO" ? "is-info" : "is-good")}>{badge.label}</span>
                  {model.recommended ? <span className="mgr-badge is-warn">Preferred</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </section>
  );
}
