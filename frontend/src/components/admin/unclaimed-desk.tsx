"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { textInputClass } from "@/components/auth/password-field";
import { apiFetch, readError } from "@/lib/auth";

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
    },
    onError: (error: Error) => setMessage(error.message),
  });
  return (
    <section className="space-y-3" aria-labelledby="unclaimed-review-heading">
      <h2 id="unclaimed-review-heading" className="font-display text-3xl">Unclaimed orders</h2>
      <p className="text-sm text-muted-foreground">
        Extending pickup does not revive an old QR code and does not refund cash. Reviewing an order does not record waste. Food safety stays a counter decision.
      </p>
      <label className="block space-y-2 text-sm">
        <span className="font-medium">Decision note</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} className={textInputClass} />
      </label>
      {orders.isError ? <p role="alert" className="text-sm text-destructive">{orders.error.message}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      <ul className="grid gap-3">
        {(orders.data?.orders ?? []).map((order) => (
          <li key={order.id} className="rounded-2xl border border-border bg-card p-4" data-testid="unclaimed-review">
            <p className="font-medium">{order.ticket_number} · {order.status}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => act.mutate({ id: order.id, path: "extend" })}>
                Extend pickup 30 minutes
              </Button>
              <Button type="button" variant="outline" onClick={() => act.mutate({ id: order.id, path: "review" })}>
                Record review
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {orders.data && orders.data.orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders are waiting for a hold decision.</p>
      ) : null}
    </section>
  );
}
