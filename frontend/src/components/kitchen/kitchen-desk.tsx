"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { apiFetch, readError } from "@/lib/auth";
import { formatEta, queueSchema, type TrackedOrder } from "@/lib/kitchen";
import { useLiveResource } from "@/lib/live";
import { formatInrFromPaise } from "@/lib/money";
import { orderSchema } from "@/lib/ordering";
import { z } from "zod";

const placedSchema = z.object({ orders: z.array(orderSchema) });

export function KitchenDesk() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [delay, setDelay] = useState("120");
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const seenTickets = useRef<Set<string> | null>(null);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["kitchen-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["incoming-orders"] });
  }, [queryClient]);
  const live = useLiveResource("/api/v1/ws/kitchen", refresh);
  const incoming = useQuery({
    queryKey: ["incoming-orders"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/staff/orders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return placedSchema.parse(await response.json());
    },
  });
  const queue = useQuery({
    queryKey: ["kitchen-queue"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/staff/queue");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return queueSchema.parse(await response.json());
    },
    refetchInterval: 3000,
  });

  async function act(path: string, body?: unknown) {
    setMessage("");
    const response = await apiFetch(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["kitchen-queue"] });
    await queryClient.invalidateQueries({ queryKey: ["incoming-orders"] });
  }

  useEffect(() => {
    const ids = new Set(incoming.data?.orders.map((order) => order.id) ?? []);
    if (seenTickets.current === null) {
      seenTickets.current = ids;
      return;
    }
    const arrived = [...ids].some((id) => !seenTickets.current?.has(id));
    seenTickets.current = ids;
    const context = audio.current;
    if (!arrived || !sound || !context) {
      return;
    }
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = 880;
    gain.gain.value = 0.04;
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.12);
  }, [incoming.data, sound]);

  const orders = queue.data?.orders ?? [];
  const waiting = orders.filter((order) => order.status === "QUEUED");
  const preparing = orders.filter((order) => order.status === "PREPARING");
  const ready = orders.filter((order) => order.status === "READY");
  const unclaimed = orders.filter((order) => order.status === "UNCLAIMED");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="connection-state">
          {live === "live" ? "Live updates connected" : "Polling for kitchen changes"}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (sound) {
              setSound(false);
              return;
            }
            const context = audio.current ?? new AudioContext();
            audio.current = context;
            void context.resume();
            setSound(true);
          }}
        >
          {sound ? "Mute new-ticket sound" : "Enable new-ticket sound"}
        </Button>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <section className="space-y-3" aria-labelledby="incoming-heading">
        <h2 id="incoming-heading" className="font-display text-3xl">
          Incoming orders
        </h2>
        {(incoming.data?.orders.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No new orders.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {incoming.data?.orders.map((order) => (
              <article key={order.id} className="rounded-2xl border border-border bg-card p-4" data-testid="incoming-order">
                <h3 className="font-display text-2xl">{order.ticket_number}</h3>
                <p className="text-sm">{order.status} · {order.payment.method} · {order.payment.status}</p>
                <ItemList items={order.items} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => act(`/api/v1/staff/orders/${order.id}/accept`)}>
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => act(`/api/v1/staff/orders/${order.id}/reject`, { reason: reason || "Cannot prepare" })}
                  >
                    Reject
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
        <label className="block max-w-md space-y-2 text-sm">
          <span className="font-medium">Reject reason</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-11 w-full rounded-full border border-border bg-card px-4" />
        </label>
      </section>
      <Board title="Waiting preparation" orders={waiting} delay={delay} setDelay={setDelay} act={act} />
      <Board title="Currently preparing" orders={preparing} delay={delay} setDelay={setDelay} act={act} />
      <section className="space-y-3">
        <h2 className="font-display text-3xl">Ready orders</h2>
        {ready.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting for collection.</p> : ready.map((order) => (
          <article key={order.id} className="rounded-2xl border border-border bg-card p-4" data-testid="ready-order">
            <h3 className="font-display text-2xl">{order.ticket_number}</h3>
            <p className="text-sm">READY · {order.payment.method} · {order.payment.status}</p>
          </article>
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="unclaimed-heading">
        <h2 id="unclaimed-heading" className="font-display text-3xl">Pickup hold ended</h2>
        {unclaimed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ready orders are past their pickup hold.</p>
        ) : (
          unclaimed.map((order) => (
            <article key={order.id} className="rounded-2xl border border-destructive/40 bg-card p-4" data-testid="unclaimed-order">
              <h3 className="font-display text-2xl">{order.ticket_number}</h3>
              <p className="text-sm">UNCLAIMED · prepared food stays recorded · a manager reviews collection</p>
            </article>
          ))
        )}
      </section>
      <section className="space-y-3" aria-labelledby="station-heading">
        <h2 id="station-heading" className="font-display text-3xl">Station workload</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {queue.data?.stations.map((station) => (
            <li key={station.id} className="rounded-2xl border border-border p-4 text-sm">
              <p className="font-medium">{station.name}</p>
              <p>{station.in_progress} preparing / {station.parallel_capacity} capacity</p>
              <p>{station.waiting} waiting · backlog about {Math.ceil(station.backlog_seconds / 60)} min</p>
              <p>{station.is_active ? "Accepting work" : "Paused"}</p>
              {station.longest_waiting_ticket ? <p>Longest wait {station.longest_waiting_ticket}</p> : null}
            </li>
          ))}
        </ul>
      </section>
      <p className="sr-only">{sound ? "sound-on" : "sound-off"}</p>
    </div>
  );
}

function Board({
  title,
  orders,
  delay,
  setDelay,
  act,
}: {
  title: string;
  orders: TrackedOrder[];
  delay: string;
  setDelay: (value: string) => void;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-3xl">{title}</h2>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">None right now.</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {orders.map((order) => (
            <article key={order.id} className="rounded-2xl border border-border bg-card p-4" data-testid="kitchen-ticket">
              <h3 className="font-display text-2xl">{order.ticket_number}</h3>
              <p className="text-sm" data-testid="ticket-status">
                {order.status} · {order.payment.method} · {order.payment.status}
              </p>
              <p className="text-sm text-muted-foreground">
                Approximate ready time {formatEta(order.eta_ready_at)}
                {order.eta_earliest_at && order.eta_latest_at
                  ? ` (${formatEta(order.eta_earliest_at)}–${formatEta(order.eta_latest_at)})`
                  : ""}
                {order.eta_overdue ? " · running long" : ""}
                {order.eta_blocked ? " · station unavailable" : ""}
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {order.tasks.filter((task) => task.status !== "CANCELLED").map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {task.item_name} #{task.unit_index} · {task.station_name} · {task.status}
                    </span>
                    <span className="flex gap-2">
                      {task.status === "QUEUED" ? (
                        <Button type="button" onClick={() => act(`/api/v1/staff/preparation-tasks/${task.id}/start`)}>
                          Start
                        </Button>
                      ) : null}
                      {task.status === "IN_PROGRESS" ? (
                        <Button type="button" onClick={() => act(`/api/v1/staff/preparation-tasks/${task.id}/complete`)}>
                          Complete
                        </Button>
                      ) : null}
                      {task.status !== "DONE" ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            act(`/api/v1/staff/preparation-tasks/${task.id}/delay`, {
                              extra_seconds: Number(delay) || 120,
                              reason: "Preparation is taking longer",
                            })
                          }
                        >
                          Delay
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {order.status === "PREPARING" && order.tasks.every((task) => task.status === "DONE") ? (
                <Button className="mt-3" type="button" onClick={() => act(`/api/v1/staff/orders/${order.id}/ready`, { packed: true })}>
                  Confirm packed and ready
                </Button>
              ) : null}
              {order.status === "QUEUED" ? (
                <Button className="mt-3" type="button" variant="outline" onClick={() => act(`/api/v1/staff/orders/${order.id}/reject`, { reason: "Cannot prepare" })}>
                  Reject
                </Button>
              ) : null}
              <p className="mt-2 text-sm">Total {formatInrFromPaise(order.total_paise)}</p>
            </article>
          ))}
        </div>
      )}
      <label className="block max-w-xs space-y-2 text-sm">
        <span className="font-medium">Delay seconds</span>
        <input value={delay} onChange={(event) => setDelay(event.target.value)} className="min-h-11 w-full rounded-full border border-border bg-card px-4" />
      </label>
    </section>
  );
}

function ItemList({ items }: { items: { menu_item_id: string; item_name: string; quantity: number }[] }) {
  return (
    <ul className="mt-2 text-sm">
      {items.map((item) => (
        <li key={item.menu_item_id}>
          {item.item_name} × {item.quantity}
        </li>
      ))}
    </ul>
  );
}
