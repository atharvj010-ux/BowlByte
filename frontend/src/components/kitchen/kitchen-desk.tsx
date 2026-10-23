"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { apiFetch, readError, roleLabel, type CurrentUser } from "@/lib/auth";
import {
  formatEta,
  formatWait,
  queueSchema,
  sortKitchenTickets,
  startBlockReason,
  type StationWorkload,
  type TrackedOrder,
} from "@/lib/kitchen";
import { liveStatusLabel, useLiveResource } from "@/lib/live";
import { formatInrFromPaise } from "@/lib/money";
import { orderSchema } from "@/lib/ordering";

const placedSchema = z.object({ orders: z.array(orderSchema) });

export function KitchenDesk({ user }: { user?: CurrentUser }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [delay, setDelay] = useState("120");
  const [sound, setSound] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [ticketErrors, setTicketErrors] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null);
  const seenTickets = useRef<Set<string> | null>(null);
  const flashRef = useRef<HTMLParagraphElement | null>(null);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["kitchen-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["incoming-orders"] });
  }, [queryClient]);

  const incoming = useQuery({
    queryKey: ["incoming-orders"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/staff/orders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return placedSchema.parse(await response.json());
    },
    refetchInterval: 4000,
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

  const live = useLiveResource(
    "/api/v1/ws/kitchen",
    refresh,
    true,
    incoming.isSuccess || queue.isSuccess,
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function act(path: string, body?: unknown, orderId?: string) {
    const key = path;
    setMessage("");
    if (orderId) {
      setTicketErrors((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
    setBusyKey(key);
    try {
      const response = await apiFetch(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const error = await readError(response);
        setMessage(error);
        if (orderId) {
          setTicketErrors((prev) => ({ ...prev, [orderId]: error }));
        }
        // Keep the failure visible where staff are looking — not only at the top.
        requestAnimationFrame(() => {
          flashRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["kitchen-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["incoming-orders"] }),
      ]);
    } catch (error) {
      const text = error instanceof Error ? error.message : "The request could not be completed.";
      setMessage(text);
      if (orderId) {
        setTicketErrors((prev) => ({ ...prev, [orderId]: text }));
      }
    } finally {
      setBusyKey(null);
    }
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
    gain.gain.value = 0.05;
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.14);
  }, [incoming.data, sound]);

  const orders = useMemo(() => queue.data?.orders ?? [], [queue.data]);
  const waiting = useMemo(
    () => sortKitchenTickets(orders.filter((order) => order.status === "QUEUED")),
    [orders],
  );
  const preparing = useMemo(
    () => sortKitchenTickets(orders.filter((order) => order.status === "PREPARING")),
    [orders],
  );
  const ready = orders.filter((order) => order.status === "READY");
  const unclaimed = orders.filter((order) => order.status === "UNCLAIMED");
  const incomingOrders = incoming.data?.orders ?? [];
  const delayedCount =
    waiting.filter((order) => order.eta_overdue || order.eta_blocked).length +
    preparing.filter((order) => order.eta_overdue || order.eta_blocked).length;
  const attentionNeeded = incomingOrders.length > 0 || delayedCount > 0;
  const liveLabel = liveStatusLabel(live);
  const stations = queue.data?.stations ?? [];

  return (
    <section className="kitchen-desk space-y-7" aria-labelledby="kitchen-heading" data-testid="kitchen-desk">
      <header className="kitchen-hero relative overflow-hidden rounded-[2rem] border border-white/5 p-6 sm:p-8">
        <div className="kitchen-hero-glow" aria-hidden="true" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl space-y-3">
            <p className="eyebrow">Kitchen floor</p>
            <h1
              id="kitchen-heading"
              className="font-display text-[clamp(2.2rem,5vw,3.6rem)] leading-[0.92] tracking-tight uppercase"
            >
              Station board
            </h1>
            {user ? (
              <p className="text-sm leading-6 text-ivory/80" data-testid="account-name">
                Signed in as {user.full_name}. Role: {roleLabel(user.role)}.
              </p>
            ) : null}
            <p className="text-sm leading-6 text-ivory/75" data-testid="connection-state">
              {liveLabel} · Accept every ticket, keep delays visible, pack only when every line is done.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`kitchen-live-pill ${live === "live" ? "kitchen-live-on" : "kitchen-live-warn"}`}
              aria-hidden="true"
            >
              <span className="kitchen-live-dot" />
              {live === "live" ? "Live" : liveLabel}
            </span>
            <Button
              type="button"
              variant={sound ? "default" : "outline"}
              className={sound ? undefined : "kitchen-sound-btn"}
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
        </div>
        <ol className="kitchen-steps relative z-10 mt-6" aria-label="Kitchen workflow">
          <li>
            <span className="kitchen-step-num">1</span>
            <span>Accept incoming</span>
          </li>
          <li>
            <span className="kitchen-step-num">2</span>
            <span>Start station work</span>
          </li>
          <li>
            <span className="kitchen-step-num">3</span>
            <span>Pack &amp; mark ready</span>
          </li>
        </ol>
      </header>

      {attentionNeeded ? (
        <div
          className="kitchen-alert"
          role="status"
          aria-live="polite"
          data-testid="kitchen-attention"
        >
          <div className="space-y-1">
            <p className="eyebrow text-ivory/70!">Needs attention</p>
            <p className="font-display text-2xl tracking-tight uppercase">
              {incomingOrders.length > 0
                ? `${incomingOrders.length} ticket${incomingOrders.length === 1 ? "" : "s"} waiting to accept`
                : null}
              {incomingOrders.length > 0 && delayedCount > 0 ? " · " : null}
              {delayedCount > 0
                ? `${delayedCount} running long or blocked`
                : null}
            </p>
            <p className="text-sm leading-6 text-ivory/75">
              Clear incoming first. Flag delays the moment prep slips so students see an updated ETA.
            </p>
          </div>
        </div>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat tone={incomingOrders.length ? "alert" : "idle"} label="Incoming" value={incomingOrders.length} hint="Accept before the queue grows" />
        <Stat tone={waiting.length ? "wait" : "idle"} label="Waiting" value={waiting.length} hint="Queued for a station" />
        <Stat tone={preparing.length ? "prep" : "idle"} label="Preparing" value={preparing.length} hint="Active on the line" />
        <Stat tone={delayedCount ? "alert" : "idle"} label="Running long" value={delayedCount} hint="Past ETA or blocked" />
        <Stat tone={ready.length ? "ready" : "idle"} label="Ready" value={ready.length} hint="Packed · cashier takes cash" />
      </dl>

      {message ? (
        <p
          ref={flashRef}
          role="alert"
          className="kitchen-flash kitchen-flash-bad kitchen-flash-sticky text-sm text-destructive"
          data-testid="kitchen-action-error"
        >
          <span>{message}</span>
          <button type="button" className="kitchen-flash-dismiss" onClick={() => setMessage("")}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <Lane
          id="incoming"
          title="Incoming orders"
          count={incomingOrders.length}
          empty="No new orders."
          tone="incoming"
          priority={incomingOrders.length > 0}
          footer={
            <label className="kitchen-field block space-y-2 text-sm">
              <span className="font-medium">Reject reason</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="kitchen-input"
                placeholder="Cannot prepare"
              />
            </label>
          }
        >
          {incomingOrders.map((order) => (
            <article
              key={order.id}
              className="kitchen-ticket kitchen-ticket-incoming"
              data-testid="incoming-order"
              data-tone="incoming"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="eyebrow text-muted-foreground!">New ticket</p>
                  <h3 className="font-display text-3xl tracking-tight">{order.ticket_number}</h3>
                </div>
                <span className="kitchen-badge kitchen-badge-incoming">Accept now</span>
              </div>
              <p className="text-sm">
                {order.status} · {order.payment.method} · {order.payment.status}
              </p>
              <ItemList items={order.items} />
              <p className="text-xs text-muted-foreground">
                Placed {formatWait(order.created_at, now)} · {formatInrFromPaise(order.total_paise)}
              </p>
              {ticketErrors[order.id] ? (
                <p role="alert" className="text-sm text-destructive" data-testid="ticket-action-error">
                  {ticketErrors[order.id]}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busyKey === `/api/v1/staff/orders/${order.id}/accept`}
                  onClick={() => void act(`/api/v1/staff/orders/${order.id}/accept`, undefined, order.id)}
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyKey === `/api/v1/staff/orders/${order.id}/reject`}
                  onClick={() =>
                    void act(
                      `/api/v1/staff/orders/${order.id}/reject`,
                      { reason: reason || "Cannot prepare" },
                      order.id,
                    )
                  }
                >
                  Reject
                </Button>
              </div>
            </article>
          ))}
        </Lane>

        <Lane
          id="waiting"
          title="Waiting preparation"
          count={waiting.length}
          empty="None right now."
          tone="waiting"
        >
          {waiting.map((order) => (
            <TicketCard
              key={order.id}
              order={order}
              now={now}
              delay={delay}
              stations={stations}
              busyKey={busyKey}
              error={ticketErrors[order.id] ?? ""}
              act={act}
            />
          ))}
        </Lane>

        <Lane
          id="preparing"
          title="Currently preparing"
          count={preparing.length}
          empty="None right now."
          tone="preparing"
          footer={
            <label className="kitchen-field block space-y-2 text-sm">
              <span className="font-medium">Delay seconds</span>
              <input
                value={delay}
                onChange={(event) => setDelay(event.target.value)}
                className="kitchen-input"
                inputMode="numeric"
              />
              <span className="text-xs text-muted-foreground">
                Applied when you tap Delay on a station line.
              </span>
            </label>
          }
        >
          {preparing.map((order) => (
            <TicketCard
              key={order.id}
              order={order}
              now={now}
              delay={delay}
              stations={stations}
              busyKey={busyKey}
              error={ticketErrors[order.id] ?? ""}
              act={act}
            />
          ))}
        </Lane>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="kitchen-lane space-y-3" aria-labelledby="ready-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ready-heading" className="font-display text-2xl tracking-tight uppercase">
              Ready orders
            </h2>
            <span className="kitchen-count">{ready.length}</span>
          </div>
          {ready.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting for collection.</p>
          ) : (
            ready.map((order) => (
              <article key={order.id} className="kitchen-ticket" data-testid="ready-order" data-tone="ready">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-display text-3xl tracking-tight">{order.ticket_number}</h3>
                  <span className="kitchen-badge kitchen-badge-ready">Packed</span>
                </div>
                <p className="text-sm">
                  READY · {order.payment.method} · {order.payment.status}
                </p>
                <p className="text-xs text-muted-foreground">
                  Cashier records cash after the student presents a pickup code.
                </p>
              </article>
            ))
          )}
        </section>

        <section className="kitchen-lane space-y-3" aria-labelledby="unclaimed-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="unclaimed-heading" className="font-display text-2xl tracking-tight uppercase">
              Pickup hold ended
            </h2>
            <span className="kitchen-count">{unclaimed.length}</span>
          </div>
          {unclaimed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ready orders are past their pickup hold.</p>
          ) : (
            unclaimed.map((order) => (
              <article
                key={order.id}
                className="kitchen-ticket kitchen-ticket-hold"
                data-testid="unclaimed-order"
                data-tone="hold"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-display text-3xl tracking-tight">{order.ticket_number}</h3>
                  <span className="kitchen-badge kitchen-badge-hold">Hold ended</span>
                </div>
                <p className="text-sm">
                  UNCLAIMED · prepared food stays recorded · a manager reviews collection
                </p>
              </article>
            ))
          )}
        </section>
      </div>

      <section className="kitchen-lane space-y-3" aria-labelledby="station-heading">
        <div className="space-y-1">
          <p className="eyebrow">Capacity</p>
          <h2 id="station-heading" className="font-display text-2xl tracking-tight uppercase">
            Station workload
          </h2>
        </div>
        <ul className="grid gap-3 md:grid-cols-3">
          {(queue.data?.stations ?? []).map((station) => {
            const load = station.parallel_capacity
              ? station.in_progress / station.parallel_capacity
              : 0;
            const hot = load >= 1 || station.waiting > 0;
            return (
              <li
                key={station.id}
                className={`kitchen-station ${hot ? "kitchen-station-hot" : ""} ${station.is_active ? "" : "kitchen-station-paused"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{station.name}</p>
                  <span className="kitchen-badge kitchen-badge-idle">
                    {station.is_active ? "Open" : "Paused"}
                  </span>
                </div>
                <p className="mt-2 font-display text-3xl tracking-tight">
                  {station.in_progress}
                  <span className="text-lg text-muted-foreground">/{station.parallel_capacity}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {station.waiting} waiting · backlog ~{Math.ceil(station.backlog_seconds / 60)} min
                </p>
                {station.longest_waiting_ticket ? (
                  <p className="mt-1 text-sm font-medium text-amber-200/90">
                    Longest wait {station.longest_waiting_ticket}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="sr-only">{sound ? "sound-on" : "sound-off"}</p>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "idle" | "alert" | "wait" | "prep" | "ready";
}) {
  return (
    <div className="kitchen-stat" data-tone={tone}>
      <dt className="eyebrow text-muted-foreground!">{label}</dt>
      <dd className="mt-2 font-display text-4xl tracking-tight">{value}</dd>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function Lane({
  id,
  title,
  count,
  empty,
  tone,
  priority,
  children,
  footer,
}: {
  id: string;
  title: string;
  count: number;
  empty: string;
  tone: "incoming" | "waiting" | "preparing";
  priority?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      className={`kitchen-lane space-y-3 ${priority ? "kitchen-lane-priority" : ""}`}
      aria-labelledby={`${id}-heading`}
      data-tone={tone}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="font-display text-2xl tracking-tight uppercase">
          {title}
        </h2>
        <span className={`kitchen-count ${count > 0 && tone === "incoming" ? "kitchen-count-hot" : ""}`}>
          {count}
        </span>
      </div>
      {count === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="grid gap-3">{children}</div>}
      {footer}
    </section>
  );
}

function TicketCard({
  order,
  now,
  delay,
  stations,
  busyKey,
  error,
  act,
}: {
  order: TrackedOrder;
  now: number;
  delay: string;
  stations: StationWorkload[];
  busyKey: string | null;
  error: string;
  act: (path: string, body?: unknown, orderId?: string) => Promise<void>;
}) {
  const overdue = order.eta_overdue;
  const blocked = order.eta_blocked;
  const tone = overdue || blocked ? "late" : order.status === "PREPARING" ? "prep" : "wait";
  const since = order.accepted_at ?? order.created_at;
  const openTasks = order.tasks.filter((task) => task.status !== "CANCELLED");
  const canPack =
    order.status === "PREPARING" && openTasks.length > 0 && openTasks.every((task) => task.status === "DONE");

  return (
    <article
      className={`kitchen-ticket ${overdue || blocked ? "kitchen-ticket-late" : ""}`}
      data-testid="kitchen-ticket"
      data-tone={tone}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="eyebrow text-muted-foreground!">
            {order.status === "PREPARING" ? "On the line" : "In queue"}
          </p>
          <h3 className="font-display text-3xl tracking-tight">{order.ticket_number}</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {overdue ? <span className="kitchen-badge kitchen-badge-late">Running long</span> : null}
          {blocked ? <span className="kitchen-badge kitchen-badge-blocked">Station blocked</span> : null}
          {!overdue && !blocked ? (
            <span className={`kitchen-badge ${order.status === "PREPARING" ? "kitchen-badge-prep" : "kitchen-badge-wait"}`}>
              {order.status === "PREPARING" ? "Preparing" : "Waiting"}
            </span>
          ) : null}
        </div>
      </div>

      <p className="text-sm" data-testid="ticket-status">
        {order.status} · {order.payment.method} · {order.payment.status}
      </p>

      <div className="kitchen-eta">
        <p className="text-sm">
          ETA {formatEta(order.eta_ready_at)}
          {order.eta_earliest_at && order.eta_latest_at
            ? ` · window ${formatEta(order.eta_earliest_at)}–${formatEta(order.eta_latest_at)}`
            : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          On board {formatWait(since, now)}
          {overdue ? " · past the estimate — flag a delay or finish the line" : ""}
          {blocked ? " · station unavailable" : ""}
        </p>
      </div>

      {error ? (
        <p role="alert" className="kitchen-ticket-error text-sm" data-testid="ticket-action-error">
          {error}
        </p>
      ) : null}

      <ul className="kitchen-tasks">
        {openTasks.map((task) => {
          const startPath = `/api/v1/staff/preparation-tasks/${task.id}/start`;
          const completePath = `/api/v1/staff/preparation-tasks/${task.id}/complete`;
          const delayPath = `/api/v1/staff/preparation-tasks/${task.id}/delay`;
          const blockReason = startBlockReason(task, stations);
          return (
            <li key={task.id} className="kitchen-task">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium leading-5">
                  {task.item_name} #{task.unit_index}
                </p>
                <p className="text-xs text-muted-foreground">
                  {task.station_name} · {task.status}
                  {task.extra_delay_seconds > 0
                    ? ` · +${Math.round(task.extra_delay_seconds / 60)} min delay`
                    : ""}
                </p>
                {task.delay_reason ? (
                  <p className="text-xs text-amber-200/90">{task.delay_reason}</p>
                ) : null}
                {task.status === "QUEUED" && blockReason ? (
                  <p className="text-xs font-medium text-amber-200" data-testid="start-blocked-reason">
                    {blockReason}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {task.status === "QUEUED" ? (
                  blockReason ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled
                      title={blockReason}
                      data-testid="start-blocked"
                    >
                      Station full
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyKey === startPath}
                      data-testid="start-task"
                      onClick={() => void act(startPath, undefined, order.id)}
                    >
                      {busyKey === startPath ? "Starting…" : "Start"}
                    </Button>
                  )
                ) : null}
                {task.status === "IN_PROGRESS" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyKey === completePath}
                    data-testid="complete-task"
                    onClick={() => void act(completePath, undefined, order.id)}
                  >
                    {busyKey === completePath ? "Saving…" : "Complete"}
                  </Button>
                ) : null}
                {task.status !== "DONE" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyKey === delayPath}
                    onClick={() =>
                      void act(
                        delayPath,
                        {
                          extra_seconds: Number(delay) || 120,
                          reason: "Preparation is taking longer",
                        },
                        order.id,
                      )
                    }
                  >
                    Delay
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {canPack ? (
        <Button
          className="w-full"
          type="button"
          disabled={busyKey === `/api/v1/staff/orders/${order.id}/ready`}
          onClick={() => void act(`/api/v1/staff/orders/${order.id}/ready`, { packed: true }, order.id)}
        >
          Confirm packed and ready
        </Button>
      ) : null}

      {order.status === "QUEUED" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busyKey === `/api/v1/staff/orders/${order.id}/reject`}
          onClick={() =>
            void act(`/api/v1/staff/orders/${order.id}/reject`, { reason: "Cannot prepare" }, order.id)
          }
        >
          Reject
        </Button>
      ) : null}

      <p className="text-sm text-muted-foreground">Total {formatInrFromPaise(order.total_paise)}</p>
    </article>
  );
}

function ItemList({ items }: { items: { menu_item_id: string; item_name: string; quantity: number }[] }) {
  return (
    <ul className="kitchen-items text-sm">
      {items.map((item) => (
        <li key={item.menu_item_id}>
          {item.item_name} × {item.quantity}
        </li>
      ))}
    </ul>
  );
}
