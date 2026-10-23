import { z } from "zod";

import { backendOrigin, backendUrl } from "@/lib/backend-origin";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  environment: z.string(),
});

export const dependencyCheckSchema = z.object({
  status: z.enum(["up", "down"]),
  detail: z.string().nullable(),
});

export const readyResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({
    postgres: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;

export function apiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  return backendOrigin();
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    throw new Error(`Empty response from ${response.url}`);
  }
  return JSON.parse(text) as unknown;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const target = typeof window === "undefined" ? backendUrl("/api/v1/health") : "/api/v1/health";
  const response = await fetch(target, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Health request failed with HTTP ${response.status}`);
  }
  return healthResponseSchema.parse(await readJson(response));
}

export async function fetchReady(): Promise<ReadyResponse> {
  const target = typeof window === "undefined" ? backendUrl("/api/v1/ready") : "/api/v1/ready";
  const response = await fetch(target, { cache: "no-store" });
  const body = readyResponseSchema.parse(await readJson(response));
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Readiness request failed with HTTP ${response.status}`);
  }
  return body;
}
