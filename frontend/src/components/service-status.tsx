"use client";

import { useQuery } from "@tanstack/react-query";

import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchHealth, fetchReady } from "@/lib/api";

function CheckCard({
  title,
  status,
  detail,
}: {
  title: string;
  status: string;
  detail?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          Status: <span className="font-medium text-foreground">{status}</span>
        </p>
        {detail ? <p className="text-muted-foreground">Detail: {detail}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ServiceStatus() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const ready = useQuery({ queryKey: ["ready"], queryFn: fetchReady });

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Badge>Live check</Badge>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">Service status</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          These values come from the API process. A failure stays visible. This page does not
          invent a healthy result.
        </p>
      </div>

      {health.isPending ? <LoadingState label="Checking the API" /> : null}
      {health.isError ? (
        <ErrorState
          title="The API did not answer"
          message="Liveness could not be read. Start the API and try again."
          onRetry={() => {
            void health.refetch();
          }}
        />
      ) : null}
      {health.data ? (
        <CheckCard
          title="API process"
          status={health.data.status}
          detail={`${health.data.service} · ${health.data.environment}`}
        />
      ) : null}

      {ready.isPending ? <LoadingState label="Checking PostgreSQL and Redis" /> : null}
      {ready.isError ? (
        <ErrorState
          title="Readiness could not be read"
          message="The readiness response was missing or did not match the contract."
          onRetry={() => {
            void ready.refetch();
          }}
        />
      ) : null}
      {ready.data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CheckCard
            title="PostgreSQL"
            status={ready.data.checks.postgres.status}
            detail={ready.data.checks.postgres.detail}
          />
          <CheckCard
            title="Redis"
            status={ready.data.checks.redis.status}
            detail={ready.data.checks.redis.detail}
          />
        </div>
      ) : null}
      {ready.data ? (
        <p className="text-sm text-muted-foreground">
          Overall readiness: {ready.data.status.replace("_", " ")}
        </p>
      ) : null}
    </div>
  );
}
