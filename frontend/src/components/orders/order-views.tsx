"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { PickupPass } from "@/components/orders/pickup-pass";
import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { formatEta, trackedOrderSchema } from "@/lib/kitchen";
import { useLiveResource } from "@/lib/live";
import { formatInrFromPaise } from "@/lib/money";
import { orderSchema, type CanteenOrder } from "@/lib/ordering";

const listSchema = z.object({ orders: z.array(orderSchema) });

function labelStep(step: string) {
  switch (step) {
    case "PLACED":
      return "Order placed";
    case "ACCEPTED":
      return "Kitchen accepted";
    case "QUEUED":
      return "Waiting in preparation queue";
    case "PREPARING":
      return "Preparing";
    case "READY":
      return "Ready for collection";
    case "PICKED_UP":
      return "Collected";
    default:
      return step;
  }
}

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

const progress = ["PLACED", "ACCEPTED", "QUEUED", "PREPARING", "READY", "PICKED_UP"] as const;

export function OrderDetail({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  }, [orderId, queryClient]);
  const live = useLiveResource(`/api/v1/ws/orders/${orderId}`, refresh);
  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/orders/${orderId}/tracking`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return trackedOrderSchema.parse(await response.json());
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

  if (order.isLoading && !order.data) {
    return <p>Loading the order.</p>;
  }
  if (order.isError && !order.data) {
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
      <p data-testid="order-status">
        {current.status} · {paymentLabel(current)}
      </p>
      <p className="text-sm text-muted-foreground" data-testid="connection-state">
        {order.isError
          ? "Showing the last confirmed order while updates are unavailable"
          : live === "live"
            ? "Live updates connected"
            : "Checking for updates"}{" "}
        · updated {new Date(current.updated_at).toLocaleTimeString()}
      </p>
      <ol className="grid gap-1 text-sm">
        {progress.map((step) => (
          <li key={step}>{step === current.status || progress.indexOf(step) < progress.indexOf(current.status as (typeof progress)[number]) ? "Done" : "Pending"} · {labelStep(step)}</li>
        ))}
      </ol>
      <p className="text-sm" data-testid="eta">
        Approximate ready time {formatEta(current.eta_ready_at)}
        {current.eta_earliest_at && current.eta_latest_at
          ? `, between ${formatEta(current.eta_earliest_at)} and ${formatEta(current.eta_latest_at)}`
          : ""}
        {current.eta_overdue ? ". Preparation is running longer than expected." : ""}
        {current.eta_blocked ? ". A station is unavailable, so there is no readiness time." : ""}
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
      {current.tasks
        .filter((task) => task.delay_reason)
        .map((task) => (
          <p key={task.id} className="text-sm" data-testid="delay-message">
            {task.item_name}: {task.delay_reason}
          </p>
        ))}
      {current.note ? <p className="text-sm">Note: {current.note}</p> : null}
      <PaymentNotice
        status={current.status}
        paymentStatus={current.payment.status}
        amountPaise={current.payment.amount_paise}
        paidAt={current.payment.paid_at ?? null}
        pickedUpAt={current.picked_up_at ?? null}
      />
      <PickupPass orderId={orderId} orderStatus={current.status} />
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

function PaymentNotice({
  status,
  paymentStatus,
  amountPaise,
  paidAt,
  pickedUpAt,
}: {
  status: string;
  paymentStatus: string;
  amountPaise: number;
  paidAt: string | null;
  pickedUpAt: string | null;
}) {
  if (status === "PICKED_UP") {
    return (
      <div className="rounded-2xl border border-primary/40 bg-secondary p-4" data-testid="payment-notice" role="status">
        <p className="font-medium">Order collected successfully. Enjoy your meal!</p>
        {pickedUpAt ? (
          <p className="text-sm text-muted-foreground">Collected {new Date(pickedUpAt).toLocaleTimeString()}</p>
        ) : null}
      </div>
    );
  }
  if (status === "READY" && paymentStatus === "PAID") {
    return (
      <div className="rounded-2xl border border-primary/40 bg-secondary p-4" data-testid="payment-notice" role="status">
        <p className="font-medium">Cash payment confirmed. Please collect your order.</p>
        {paidAt ? (
          <p className="text-sm text-muted-foreground">Confirmed {new Date(paidAt).toLocaleTimeString()}</p>
        ) : null}
      </div>
    );
  }
  if (status === "READY") {
    return (
      <div className="rounded-2xl border border-accent/60 bg-card p-4" data-testid="payment-notice" role="status">
        <p className="font-medium">
          Your order is ready. Pay {formatInrFromPaise(amountPaise)} in cash at the counter.
        </p>
      </div>
    );
  }
  if (status === "CANCELLED" || status === "REJECTED") {
    return null;
  }
  return (
    <p className="text-sm text-muted-foreground" data-testid="payment-notice">
      You pay cash at the counter once your order is ready. Nothing is charged online.
    </p>
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
        New placed tickets. Accept them from the kitchen desk. The cashier records cash after the order is ready.
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
