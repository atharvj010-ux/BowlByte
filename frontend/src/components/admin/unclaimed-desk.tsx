"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { EmptyState, Notice, Panel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";

const holdOrderSchema = z.object({
  id: z.string(),
  ticket_number: z.string(),
  status: z.string(),
  total_paise: z.number().int(),
  events: z.array(z.object({ action: z.string(), note: z.string().nullable(), created_at: z.string() })),
});

async function readOrders(response: Response) {
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return z.object({ orders: z.array(holdOrderSchema) }).parse(await response.json());
}

export function UnclaimedDesk() {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("Counter reviewed the prepared food.");
  const [message, setMessage] = useState("");
  const orders = useQuery({
    queryKey: ["unclaimed-orders"],
    queryFn: () => apiFetch("/api/v1/admin/orders/unclaimed").then(readOrders),
  });
  const act = useMutation({
    mutationFn: async (input: { id: string; path: "extend" | "review" }) => {
      const response = await apiFetch(`/api/v1/admin/orders/${input.id}/hold/${input.path}`, {
        method: "POST",
        body: JSON.stringify(
          input.path === "extend" ? { minutes: 30, note } : { note },
        ),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
    },
    onSuccess: async () => {
      setMessage("Decision recorded. Payment and stock were not changed.");
      await queryClient.invalidateQueries({ queryKey: ["unclaimed-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["mgr", "unclaimed"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const list = orders.data?.orders ?? [];
  return (
    <section aria-labelledby="unclaimed-review-heading">
      <Panel
        title="Unclaimed orders"
        titleId="unclaimed-review-heading"
        tone={list.length > 0 ? "#ff8d7a" : undefined}
        subtitle="Extending pickup does not revive an old QR code and does not refund cash. Reviewing an order does not record waste. Food safety stays a counter decision."
        action={
          orders.data ? (
            <span className={list.length > 0 ? "mgr-badge is-bad" : "mgr-badge is-good"}>
              {list.length > 0 ? `${list.length} waiting` : "None waiting"}
            </span>
          ) : null
        }
      >
        {orders.isError ? <Notice tone="error">{orders.error.message}</Notice> : null}
        {message ? <Notice tone={act.isError ? "error" : "success"}>{message}</Notice> : null}
        {list.length > 0 ? (
          <>
            <label className="mgr-field">
              <span>Decision note</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} className={textInputClass} />
            </label>
            <ul className="mgr-list">
              {list.map((order) => {
                const last = order.events[order.events.length - 1];
                return (
                  <li key={order.id} className="mgr-list-row" data-testid="unclaimed-review">
                    <div className="min-w-0">
                      <p className="mgr-row-title">
                        {order.ticket_number} · {order.status}
                      </p>
                      <p className="mgr-row-meta">
                        {formatInrFromPaise(order.total_paise)}
                        {last?.note ? ` · Last note: ${last.note}` : ""}
                      </p>
                    </div>
                    <div className="mgr-actions">
                      <Button
                        type="button"
                        size="sm"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: order.id, path: "extend" })}
                      >
                        Extend pickup 30 minutes
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: order.id, path: "review" })}
                      >
                        Record review
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {orders.data && list.length === 0 ? (
          <EmptyState>No orders are waiting for a hold decision.</EmptyState>
        ) : null}
      </Panel>
    </section>
  );
}
