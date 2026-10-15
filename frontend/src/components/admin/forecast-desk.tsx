"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { newKey } from "@/lib/cash";
import { forecastRunSchema, formatMetric, modelSchema, rangeText, sourceBadge } from "@/lib/intelligence";

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

  return (
    <section className="space-y-6" data-testid="forecast-desk">
      <div>
        <h1 className="font-display text-4xl">Forecasts</h1>
        <p className="text-sm text-muted-foreground">
          Expected portions per item per upcoming open day. A prediction is not a recorded sale.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={busy} onClick={loadDemo} data-testid="load-demo">
          Load demo history
        </Button>
        <Button type="button" disabled={busy} onClick={() => train("DEMO")} data-testid="train-demo">
          Train on demo history
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => train("REAL")} data-testid="train-real">
          Train on recorded history
        </Button>
        <Button type="button" disabled={busy} onClick={() => generate("DEMO")} data-testid="forecast-demo">
          Forecast from demo
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => generate("REAL")} data-testid="forecast-real">
          Forecast from recorded history
        </Button>
      </div>
      {message ? <p data-testid="forecast-notice">{message}</p> : null}
      {models.isLoading ? <p>Loading models.</p> : null}
      {models.isError ? <p role="alert">{models.error.message}</p> : null}
      {models.data && models.data.models.length === 0 ? <p>No model has been trained.</p> : null}
      <ul className="space-y-3" data-testid="model-list">
        {models.data?.models.map((model) => {
          const badge = sourceBadge(model.source);
          const holdout = model.evaluations.find((row) => row.role === "HOLDOUT");
          return (
            <li key={model.id} className="rounded-2xl border border-border p-4 text-sm" data-testid="model-card">
              <p>
                {model.algorithm} · {model.status} · {badge.label}
                {model.recommended ? " · preferred" : ""}
              </p>
              <p>{model.selection_reason}</p>
              <p>Cutoff {model.training_cutoff}</p>
              {holdout ? (
                <p>
                  Holdout MAE {formatMetric(holdout.mae)}, WAPE {formatMetric(holdout.wape)}, bias {formatMetric(holdout.bias)}, {holdout.n_points} points. This score is for {badge.label} data only.
                </p>
              ) : (
                <p>No holdout score. The model was not evaluated on a separate period.</p>
              )}
            </li>
          );
        })}
      </ul>
      {run ? (
        <div data-testid="forecast-result">
          <p>
            {run.status} · {run.method} · {sourceBadge(run.source).label} · cutoff {run.data_cutoff}
          </p>
          <p>{run.limitations}</p>
          <ul>
            {run.values?.map((value) => (
              <li key={`${value.menu_item_id}-${value.service_date}`}>
                {value.service_date}: {value.predicted_qty ?? "insufficient"} portions. {rangeText(value.range_kind, value.lower_qty, value.upper_qty)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
