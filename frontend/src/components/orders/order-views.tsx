"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { orderSchema, type CanteenOrder } from "@/lib/ordering";

const listSchema = z.object({ orders: z.array(orderSchema) });

function paymentLabel(order: CanteenOrder) {
  return `${order.payment.method} · ${order.payment.status}`;
}

export function OrderHistory() {
  const orders = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/orders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return listSchema.parse(await response.json());
    },
  });
  if (orders.isLoading) {
    return <p>Loading orders.</p>;
  }
  if (orders.isError) {
    return <p className="text-sm text-destructive">{orders.error.message}</p>;
  }
  const history = orders.data;
  if (!history || history.orders.length === 0) {
    return <p className="text-sm text-muted-foreground">You have not placed an order.</p>;
  }
  return (
    <ul className="grid gap-3">
      {history.orders.map((order) => (
        <li key={order.id} className="rounded-2xl border border-border bg-card p-4">
          <a href={`/student/orders/${order.id}`} className="font-medium underline-offset-4 hover:underline">
            {order.ticket_number}
          </a>
          <p className="text-sm text-muted-foreground">
            {order.status} · {paymentLabel(order)} · {formatInrFromPaise(order.total_paise)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/orders/${orderId}`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return orderSchema.parse(await response.json());
    },
  });

  async function cancel() {
    setMessage("");
    const response = await apiFetch(`/api/v1/orders/${orderId}/cancel`, { method: "POST" });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    setMessage("The order is cancelled and its portions were released.");
  }

  if (order.isLoading) {
    return <p>Loading the order.</p>;
  }
  if (order.isError) {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid="order-denied">
        {order.error.message}
      </p>
    );
  }
  const current = order.data;
  if (!current) {
    return <p>Loading the order.</p>;
  }
  return (
    <article className="space-y-4">
      <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">Ticket</p>
      <h2 className="font-display text-4xl">{current.ticket_number}</h2>
      <p>
        {current.status} · {paymentLabel(current)}
      </p>
      <p className="text-sm text-muted-foreground">
        Placed {new Date(current.created_at).toLocaleString()}
      </p>
      <ul className="grid gap-2">
        {current.items.map((item) => (
          <li key={item.menu_item_id} className="flex justify-between gap-3 text-sm">
            <span>
              {item.item_name} × {item.quantity}
            </span>
            <span>{formatInrFromPaise(item.line_total_paise)}</span>
          </li>
        ))}
      </ul>
      <p className="font-medium">Total {formatInrFromPaise(current.total_paise)}</p>
      {current.note ? <p className="text-sm">Note: {current.note}</p> : null}
      <p className="text-sm text-muted-foreground">
        Cash has not been collected. Payment stays pending until a later cashier step.
      </p>
      {current.status === "PLACED" ? (
        <Button type="button" variant="outline" onClick={cancel}>
          Cancel order
        </Button>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </article>
  );
}

export function IncomingOrders() {
  const orders = useQuery({
    queryKey: ["incoming-orders"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/staff/orders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return listSchema.parse(await response.json());
    },
  });
  if (orders.isLoading) {
    return <p>Loading incoming orders.</p>;
  }
  if (orders.isError) {
    return <p className="text-sm text-destructive">{orders.error.message}</p>;
  }
  return (
    <section className="space-y-4" aria-labelledby="incoming-heading">
      <h2 id="incoming-heading" className="font-display text-3xl">
        Incoming orders
      </h2>
      <p className="text-sm text-muted-foreground">
        New placed tickets only. Preparation, ready times, and cash collection are later phases.
      </p>
      {!orders.data || orders.data.orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No new orders.</p>
      ) : (
        <ul className="grid gap-3">
          {orders.data.orders.map((order) => (
            <li key={order.id} className="rounded-2xl border border-border bg-card p-4" data-testid="incoming-order">
              <p className="font-medium">{order.ticket_number}</p>
              <p className="text-sm text-muted-foreground">
                {order.status} · {paymentLabel(order)} · {new Date(order.created_at).toLocaleTimeString()}
              </p>
              <ul className="mt-2 text-sm">
                {order.items.map((item) => (
                  <li key={item.menu_item_id}>
                    {item.item_name} × {item.quantity}
                  </li>
                ))}
              </ul>
              {order.note ? <p className="mt-2 text-sm">Note: {order.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
