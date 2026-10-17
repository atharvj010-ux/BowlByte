"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { z } from "zod";

import { PickupPass } from "@/components/orders/pickup-pass";
import { Button } from "@/components/ui/button";
import { apiFetch, fetchCurrentUser, readError } from "@/lib/auth";
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
  const me = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });
  const orders = useQuery({
    queryKey: ["my-orders", me.data?.id],
    enabled: me.data?.role === "STUDENT",
    queryFn: async () => {
      const response = await apiFetch("/api/v1/orders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return listSchema.parse(await response.json());
    },
  });
  if (me.isPending || (me.data?.role === "STUDENT" && orders.isPending)) {
    return <p>Loading orders.</p>;
  }
  if (me.data?.role !== "STUDENT" || !orders.isSuccess) {
    return (
      <p className="text-sm text-destructive" data-testid="orders-denied">
        {orders.isError ? orders.error.message : "Sign in to see your orders."}
      </p>
    );
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
  const me = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["order", me.data?.id, orderId] });
  }, [me.data?.id, orderId, queryClient]);
  const order = useQuery({
    queryKey: ["order", me.data?.id, orderId],
    enabled: me.data?.role === "STUDENT",
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/orders/${orderId}/tracking`);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return trackedOrderSchema.parse(await response.json());
    },
  });
  const live = useLiveResource(
    `/api/v1/ws/orders/${orderId}`,
    refresh,
    me.data?.role === "STUDENT" && order.isSuccess,
  );

  async function cancel() {
    setMessage("");
    const response = await apiFetch(`/api/v1/orders/${orderId}/cancel`, { method: "POST" });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["order", me.data?.id, orderId] });
    setMessage("The order is cancelled and its portions were released.");
  }

  if (me.isPending || (me.data?.role === "STUDENT" && order.isPending)) {
    return <p>Loading the order.</p>;
  }
  if (me.data?.role !== "STUDENT" || !order.isSuccess) {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid="order-denied">
        {order.isError ? order.error.message : "Sign in to see this order."}
      </p>
    );
  }
  const current = order.data;
  if (!current) {
    return <p>Loading the order.</p>;
  }
  const currentIndex = progress.indexOf(current.status as (typeof progress)[number]);
  const tone = statusTone(current.status);
  const fraction = currentIndex >= 0 ? currentIndex / (progress.length - 1) : 0;
  return (
    <article className="grid gap-5 lg:grid-cols-[1.2fr_1fr] lg:items-start" style={{ ["--tone" as string]: tone }}>
      <div className="space-y-5">
        <header className="track-hero space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Ticket</p>
            <p className="font-mono text-[0.68rem] tracking-[0.14em] text-muted-foreground uppercase" data-testid="connection-state">
              {live === "live" ? "Live updates connected" : "Checking for updates"}{" "}
              · updated {new Date(current.updated_at).toLocaleTimeString()}
            </p>
          </div>
          <h2 className="font-display text-7xl leading-none font-extrabold tracking-tight">{current.ticket_number}</h2>
          <motion.p
            key={current.status}
            className="font-display text-3xl font-bold uppercase"
            style={{ color: tone }}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {headline(current.status)}
          </motion.p>
          <p data-testid="order-status" className="font-mono text-sm tracking-[0.1em]">
            {current.status} · {paymentLabel(current)}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <motion.div
              className="h-full rounded-full"
              style={{ background: tone, boxShadow: `0 0 16px ${tone}` }}
              initial={false}
              animate={{ width: `${Math.max(fraction, 0.04) * 100}%` }}
              transition={{ type: "spring", stiffness: 80, damping: 20 }}
            />
          </div>
        </header>

        <ol className="track-rail rounded-[1.6rem] border border-border bg-card p-4" aria-label="Progress">
          {progress.map((step, index) => {
            const done = step === current.status || (currentIndex >= 0 && index < currentIndex);
            return (
              <li
                key={step}
                className="track-step"
                data-done={done ? "true" : "false"}
                data-current={step === current.status ? "true" : "false"}
              >
                <span className="track-dot" aria-hidden="true" />
                <span>
                  <span className="font-mono text-[0.68rem] tracking-[0.12em] text-muted-foreground uppercase">
                    {done ? "Done" : "Pending"} ·
                  </span>{" "}
                  {labelStep(step)}
                </span>
              </li>
            );
          })}
        </ol>

        {current.tasks.length > 0 ? (
          <section className="space-y-2" aria-labelledby="tasks-heading">
            <h3 id="tasks-heading" className="eyebrow">
              Kitchen tasks
            </h3>
            <ul className="grid gap-2">
              {current.tasks.map((task) => (
                <li key={task.id} className="task-chip">
                  <span className="truncate">
                    {task.item_name}
                    <span className="text-muted-foreground"> · {task.station_name}</span>
                  </span>
                  <span className="font-mono text-xs tracking-[0.1em] uppercase">{taskLabel(task.status)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {current.tasks
          .filter((task) => task.delay_reason)
          .map((task) => (
            <p key={task.id} className="text-sm" data-testid="delay-message">
              {task.item_name}: {task.delay_reason}
            </p>
          ))}
      </div>

      <div className="space-y-5">
        <div className="track-eta" data-testid="eta">
          <p className="font-mono text-[0.68rem] tracking-[0.14em] uppercase">Approximate ready time</p>{" "}
          <p className="font-display text-5xl font-extrabold">{formatEta(current.eta_ready_at)}</p>
          <p className="text-sm">
            {current.eta_earliest_at && current.eta_latest_at
              ? `Between ${formatEta(current.eta_earliest_at)} and ${formatEta(current.eta_latest_at)}. An estimate from the kitchen queue.`
              : "An estimate from the kitchen queue."}
            {current.eta_overdue ? " Preparation is running longer than expected." : ""}
            {current.eta_blocked ? " A station is unavailable, so there is no readiness time." : ""}
          </p>
        </div>
        <PaymentNotice
          status={current.status}
          paymentStatus={current.payment.status}
          amountPaise={current.payment.amount_paise}
          paidAt={current.payment.paid_at ?? null}
          pickedUpAt={current.picked_up_at ?? null}
        />
        <PickupPass
          orderId={orderId}
          orderStatus={current.status}
          ticketNumber={current.ticket_number}
          paymentStatus={current.payment.status}
        />
        <section className="summary" aria-label="Order items">
          {current.items.map((item) => (
            <div key={item.menu_item_id} className="summary-row">
              <span>
                {item.item_name} × {item.quantity}
              </span>
              <span>{formatInrFromPaise(item.line_total_paise)}</span>
            </div>
          ))}
          <div className="summary-row border-t border-border pt-3 font-semibold">
            <span>Total</span>
            <span>{formatInrFromPaise(current.total_paise)}</span>
          </div>
          <p className="fine">Placed {new Date(current.created_at).toLocaleString()}</p>
          {current.note ? <p className="text-sm">Note: {current.note}</p> : null}
        </section>
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
      </div>
    </article>
  );
}

function statusTone(status: string) {
  switch (status) {
    case "PLACED":
    case "ACCEPTED":
      return "#f6d15a";
    case "QUEUED":
    case "PREPARING":
      return "#4aa8ff";
    case "READY":
      return "#ff5c8a";
    case "PICKED_UP":
      return "#3df28b";
    case "UNCLAIMED":
    case "CANCELLED":
    case "REJECTED":
      return "#ff8d7a";
    default:
      return "#d5f25b";
  }
}

function headline(status: string) {
  switch (status) {
    case "PLACED":
      return "Sent to the kitchen";
    case "ACCEPTED":
      return "THE KITCHEN'S ON IT.";
    case "QUEUED":
      return "In line at a station";
    case "PREPARING":
      return "On the stove";
    case "READY":
      return "Ready at the counter";
    case "PICKED_UP":
      return "Enjoy your food";
    case "UNCLAIMED":
      return "Hold ended";
    case "CANCELLED":
      return "Cancelled";
    case "REJECTED":
      return "Not accepted";
    default:
      return status;
  }
}

function taskLabel(status: string) {
  switch (status) {
    case "IN_PROGRESS":
      return "Cooking";
    case "DONE":
      return "Cooked";
    case "QUEUED":
      return "Waiting";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status.replace(/_/g, " ").toLowerCase();
  }
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
  if (status === "UNCLAIMED") {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-card p-4" data-testid="payment-notice" role="status">
        <p className="font-medium">The pickup hold for this order has ended.</p>
        <p className="text-sm text-muted-foreground">
          Ask the counter. This is not a refund, and an old QR code cannot be used. A manager decides whether the food can still be handed over.
        </p>
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
