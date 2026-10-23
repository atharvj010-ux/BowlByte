"use client";

import "./manager-desk.css";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { z } from "zod";

import { apiFetch, readError, roleLabel, type CurrentUser } from "@/lib/auth";
import { cashSummarySchema, isoDate } from "@/lib/cash";
import { overviewSchema as intelligenceOverviewSchema } from "@/lib/intelligence";
import { overviewSchema as kitchenOverviewSchema } from "@/lib/kitchen";
import { formatInrFromPaise } from "@/lib/money";
import { stockLevel, type StockLevel } from "@/lib/ordering";
import { cn } from "@/lib/utils";

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

const ORDER_TABS = [
  { value: "", label: "All" },
  { value: "PLACED", label: "Placed" },
  { value: "QUEUED", label: "Queued" },
  { value: "PREPARING", label: "Preparing" },
  { value: "READY", label: "Ready" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

const DONUT_TONES = ["#4aa8ff", "#ff5c8a", "#f6d15a", "#3df28b", "#f15438"];

const managerOrdersSchema = z.object({
  orders: z.array(
    z.object({
      id: z.string(),
      ticket_number: z.string(),
      status: z.string(),
      total_paise: z.number(),
      created_at: z.string().optional(),
      student_name: z.string().nullable().optional(),
      payment: z.object({ method: z.string(), status: z.string(), amount_paise: z.number() }),
      items: z.array(z.object({ item_name: z.string(), quantity: z.number() })),
    }),
  ),
  total: z.number().optional(),
});

const stockLevelEnum = z.enum(["IN_STOCK", "FEW_LEFT", "OUT_OF_STOCK"]);

const stockSchema = z.object({
  rows: z.array(
    z
      .object({
        menu_item_id: z.union([z.string(), z.number()]).transform(String),
        name: z.string(),
        available_qty: z.number(),
        is_active: z.boolean().optional(),
        stock_level: z.unknown().optional(),
      })
      .transform((row) => {
        const parsed = stockLevelEnum.safeParse(row.stock_level);
        const level: StockLevel = parsed.success
          ? parsed.data
          : stockLevel({ available_qty: row.available_qty });
        return { id: row.menu_item_id, name: row.name, active: row.is_active !== false, level };
      }),
  ),
});

const unclaimedSchema = z.object({ orders: z.array(z.unknown()) });

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return schema.parse(await response.json());
}

function shiftDays(base: string, delta: number): string {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDate(date);
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function timeLabel(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function minutes(seconds: number | null | undefined): string {
  if (seconds == null) {
    return "—";
  }
  const mins = Math.round(seconds / 60);
  if (mins < 60) {
    return `${mins} min`;
  }
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").toLowerCase();
}

function Skeleton({ className }: { className?: string }) {
  return <span className={cn("mgr-skel", className)} aria-hidden="true" />;
}

function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mgr-error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function Card({
  title,
  subtitle,
  action,
  className,
  children,
  delay = 0,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      className={cn("mgr-card", className)}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 28, delay }}
    >
      <header className="mgr-card-head">
        <div>
          <h2 className="mgr-card-title">{title}</h2>
          {subtitle ? <p className="mgr-card-sub">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </motion.section>
  );
}

function Kpi({
  label,
  value,
  foot,
  tone,
  href,
  loading,
  children,
  delay = 0,
}: {
  label: string;
  value: string;
  foot: ReactNode;
  tone: string;
  href: string;
  loading: boolean;
  children?: ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 28, delay }}
    >
      <Link href={href} className="mgr-kpi" style={{ ["--tone" as string]: tone }}>
        <span className="mgr-kpi-label">{label}</span>
        {loading ? <Skeleton className="mgr-skel-value" /> : <span className="mgr-kpi-value">{value}</span>}
        <span className="mgr-kpi-foot">{loading ? <Skeleton className="mgr-skel-line" /> : foot}</span>
        {children}
      </Link>
    </motion.div>
  );
}

function SegmentBar({ parts }: { parts: { value: number; tone: string; label: string }[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="mgr-segbar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {total === 0 ? (
        <span className="mgr-segbar-empty" />
      ) : (
        parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.label}
              title={`${part.label}: ${part.value}`}
              style={{ flexGrow: part.value, background: part.tone }}
            />
          ))
      )}
    </div>
  );
}

function DemandChart({
  days,
}: {
  days: { date: string; ordered: number; picked: number }[];
}) {
  const peak = Math.max(0, ...days.map((day) => Math.max(day.ordered, day.picked)));
  const max = Math.max(2, Math.ceil(peak / 2) * 2);
  const ticks = [max, max / 2, 0];
  const every = days.length > 14 ? 5 : days.length > 7 ? 2 : 1;
  return (
    <div className="mgr-chart">
      <div className="mgr-chart-axis" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span key={index}>{tick}</span>
        ))}
      </div>
      <div className="mgr-chart-plot">
        <div className="mgr-chart-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="mgr-chart-bars">
          {days.map((day, index) => (
            <div
              key={day.date}
              className="mgr-chart-col"
              title={`${dayLabel(day.date)} · ${day.ordered} ordered · ${day.picked} picked up`}
            >
              <div className="mgr-chart-pair">
                <span className="is-ordered" style={{ height: `${(day.ordered / max) * 100}%` }} />
                <span className="is-picked" style={{ height: `${(day.picked / max) * 100}%` }} />
              </div>
              <span className="mgr-chart-x">{index % every === 0 ? dayLabel(day.date) : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Donut({ slices }: { slices: { label: string; value: number; tone: string }[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const arcs = slices.map((slice, index) => {
    const length = total ? (slice.value / total) * circumference : 0;
    const before = slices
      .slice(0, index)
      .reduce((sum, previous) => sum + (total ? (previous.value / total) * circumference : 0), 0);
    return { ...slice, length, offset: before };
  });
  return (
    <div className="mgr-donut">
      <div className="mgr-donut-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(244,237,221,0.07)" strokeWidth="12" />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={arc.tone}
              strokeWidth="12"
              strokeDasharray={`${arc.length} ${circumference - arc.length}`}
              strokeDashoffset={-arc.offset}
              transform="rotate(-90 50 50)"
            />
          ))}
        </svg>
        <span className="mgr-donut-center">
          <strong>{total}</strong>
          portions
        </span>
      </div>
      <ul className="mgr-legend">
        {slices.map((slice) => (
          <li key={slice.label}>
            <span className="mgr-legend-dot" style={{ background: slice.tone }} />
            <span className="mgr-legend-name">{slice.label}</span>
            <strong>{slice.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ManagerDesk({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient();
  const [rangeDays, setRangeDays] = useState<number>(7);
  const [orderStatus, setOrderStatus] = useState("");
  const [search, setSearch] = useState("");

  const today = isoDate(new Date());
  const from = shiftDays(today, -(rangeDays - 1));
  const chartDays = Math.max(rangeDays, 7);
  const chartFrom = shiftDays(today, -(chartDays - 1));

  const cash = useQuery({
    queryKey: ["mgr", "cash", from, today],
    queryFn: () => getJson(`/api/v1/admin/cash/summary?date_from=${from}&date_to=${today}`, cashSummarySchema),
    placeholderData: keepPreviousData,
  });
  const intel = useQuery({
    queryKey: ["mgr", "intel", chartFrom, today],
    queryFn: () =>
      getJson(
        `/api/v1/admin/intelligence/overview?date_from=${chartFrom}&date_to=${today}`,
        intelligenceOverviewSchema,
      ),
    placeholderData: keepPreviousData,
  });
  const kitchen = useQuery({
    queryKey: ["mgr", "kitchen"],
    queryFn: () => getJson("/api/v1/admin/kitchen/overview", kitchenOverviewSchema),
    refetchInterval: 15_000,
  });
  const orders = useQuery({
    queryKey: ["mgr", "orders", orderStatus],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "15" });
      if (orderStatus) {
        params.set("status", orderStatus);
      }
      return getJson(`/api/v1/admin/orders?${params.toString()}`, managerOrdersSchema);
    },
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });
  const stock = useQuery({
    queryKey: ["mgr", "stock"],
    queryFn: () => getJson("/api/v1/admin/stock", stockSchema),
    refetchInterval: 60_000,
  });
  const unclaimed = useQuery({
    queryKey: ["mgr", "unclaimed"],
    queryFn: () => getJson("/api/v1/admin/orders/unclaimed", unclaimedSchema),
    refetchInterval: 60_000,
  });

  const queries = [cash, intel, kitchen, orders, stock, unclaimed];
  const refreshing = queries.some((query) => query.isFetching);
  const updatedAt = Math.max(...queries.map((query) => query.dataUpdatedAt));

  const demandDays = useMemo(() => {
    const byDate = new Map((intel.data?.by_day ?? []).map((row) => [row.service_date, row]));
    return Array.from({ length: chartDays }, (_, index) => {
      const date = shiftDays(chartFrom, index);
      const row = byDate.get(date);
      return { date, ordered: row?.ordered ?? 0, picked: row?.picked_up ?? 0 };
    });
  }, [intel.data, chartDays, chartFrom]);

  const rangeDemand = demandDays.slice(-rangeDays);
  const rangeOrdered = rangeDemand.reduce((sum, day) => sum + day.ordered, 0);
  const rangePicked = rangeDemand.reduce((sum, day) => sum + day.picked, 0);

  const topSlices = (intel.data?.top_items ?? [])
    .filter((item) => item.qty_ordered > 0)
    .slice(0, 5)
    .map((item, index) => ({ label: item.name, value: item.qty_ordered, tone: DONUT_TONES[index] }));

  const shelf = (stock.data?.rows ?? []).filter((row) => row.active);
  const shelfCounts = {
    in: shelf.filter((row) => row.level === "IN_STOCK").length,
    few: shelf.filter((row) => row.level === "FEW_LEFT").length,
    out: shelf.filter((row) => row.level === "OUT_OF_STOCK").length,
  };
  const shelfWatch = shelf.filter((row) => row.level !== "IN_STOCK").slice(0, 6);

  const live = kitchen.data;
  const stations = (live?.stations ?? []).filter((station) => station.is_active);
  const capacity = stations.reduce((sum, station) => sum + station.parallel_capacity, 0);
  const cooking = stations.reduce((sum, station) => sum + station.in_progress, 0);
  const busiestStations = [...stations]
    .sort(
      (a, b) =>
        b.in_progress + b.waiting - (a.in_progress + a.waiting) ||
        b.backlog_seconds - a.backlog_seconds ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 6);
  const pausedStations = (live?.stations.length ?? 0) - stations.length;
  const hiddenStations = stations.length - busiestStations.length;
  const settled = queries.every((query) => !query.isLoading);

  const alerts: { tone: string; text: string; href: string }[] = [];
  if (cash.data && cash.data.ready_awaiting_payment > 0) {
    alerts.push({
      tone: "#f6d15a",
      text: `${cash.data.ready_awaiting_payment} ready orders waiting for cash (${formatInrFromPaise(cash.data.ready_awaiting_payment_paise)})`,
      href: "/admin/cash",
    });
  }
  if (cash.data && cash.data.paid_awaiting_pickup > 0) {
    alerts.push({
      tone: "#4aa8ff",
      text: `${cash.data.paid_awaiting_pickup} paid orders not yet collected`,
      href: "/admin/orders",
    });
  }
  if (live && live.delayed_orders > 0) {
    alerts.push({ tone: "#ff5c8a", text: `${live.delayed_orders} kitchen orders running late`, href: "/admin/kitchen" });
  }
  if (stations.length === 0 && live) {
    alerts.push({ tone: "#ff5c8a", text: "No active kitchen station — orders cannot be cooked", href: "/admin/stations" });
  }
  if (shelfCounts.out > 0) {
    alerts.push({ tone: "#ff8d7a", text: `${shelfCounts.out} dishes marked sold out`, href: "/admin/stock" });
  }
  if (unclaimed.data && unclaimed.data.orders.length > 0) {
    alerts.push({
      tone: "#ff8d7a",
      text: `${unclaimed.data.orders.length} unclaimed orders need a decision`,
      href: "/admin/orders",
    });
  }

  const needle = search.trim().toLowerCase();
  const visibleOrders = (orders.data?.orders ?? []).filter(
    (order) =>
      !needle ||
      order.ticket_number.toLowerCase().includes(needle) ||
      (order.student_name ?? "").toLowerCase().includes(needle) ||
      order.items.some((item) => item.item_name.toLowerCase().includes(needle)),
  );

  const rangeName = rangeDays === 1 ? "today" : `last ${rangeDays} days`;

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ["mgr"] });
  }

  return (
    <main className="mgr-page" data-testid="manager-desk">
      <header className="mgr-head">
        <div className="mgr-head-copy">
          <p className="mgr-kicker">{roleLabel(user.role)} · Canteen dashboard</p>
          <h1 className="mgr-title">Hello, {user.full_name}</h1>
          <p className="mgr-sub" data-testid="account-name">
            Signed in as {user.full_name}. Track cash, orders, the kitchen, and stock in one place.
          </p>
        </div>
        <div className="mgr-head-tools">
          <div className="mgr-range" role="group" aria-label="Date range">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                aria-pressed={rangeDays === range.days}
                className={cn(rangeDays === range.days && "is-active")}
                onClick={() => setRangeDays(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button type="button" className="mgr-refresh" onClick={refreshAll} disabled={refreshing}>
            <span className={cn("mgr-refresh-icon", refreshing && "is-spinning")} aria-hidden="true">
              ↻
            </span>
            Refresh
          </button>
        </div>
      </header>
      <p className="mgr-updated">
        {updatedAt > 0 ? `Updated ${new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Loading live data…"}
        {" · Dates are UTC service days · Cash is counted only at the counter"}
      </p>

      <section className="mgr-alerts" aria-label="Needs attention">
        {alerts.length === 0 ? (
          <p className="mgr-alert is-clear">
            <span className="mgr-alert-dot" aria-hidden="true" />
            {settled ? "All clear — nothing needs your attention right now." : "Checking the floor…"}
          </p>
        ) : (
          alerts.map((alert) => (
            <Link key={alert.text} href={alert.href} className="mgr-alert" style={{ ["--tone" as string]: alert.tone }}>
              <span className="mgr-alert-dot" aria-hidden="true" />
              {alert.text}
              <span className="mgr-alert-go" aria-hidden="true">
                →
              </span>
            </Link>
          ))
        )}
      </section>

      <section
        className={cn("mgr-kpis", cash.isPlaceholderData && "is-stale")}
        aria-label="Key numbers"
        aria-busy={cash.isPlaceholderData}
      >
        <Kpi
          label={`Net cash · ${rangeName}`}
          value={cash.data ? formatInrFromPaise(cash.data.net_cash_paise) : "—"}
          foot={
            cash.isError
              ? cash.error.message
              : cash.data
                ? `${cash.data.receipts_recorded} receipts · ${formatInrFromPaise(cash.data.reversed_paise)} voided`
                : ""
          }
          tone="#3df28b"
          href="/admin/cash"
          loading={cash.isLoading}
          delay={0.02}
        >
          <SegmentBar
            parts={[
              { label: "Kept", value: cash.data?.net_cash_paise ?? 0, tone: "#3df28b" },
              { label: "Voided", value: cash.data?.reversed_paise ?? 0, tone: "#ff5c8a" },
            ]}
          />
        </Kpi>
        <Kpi
          label={`Orders · ${rangeName}`}
          value={String(cash.data?.orders_placed ?? rangeOrdered)}
          foot={
            cash.data
              ? `${formatInrFromPaise(cash.data.orders_placed_value_paise)} placed · ${cash.data.picked_up_orders} collected`
              : ""
          }
          tone="#4aa8ff"
          href="/admin/orders"
          loading={cash.isLoading}
          delay={0.06}
        >
          <div className="mgr-spark" aria-hidden="true">
            {rangeDemand.map((day) => (
              <span
                key={day.date}
                style={{
                  height: `${Math.max(6, (day.ordered / Math.max(1, ...rangeDemand.map((d) => d.ordered))) * 100)}%`,
                }}
              />
            ))}
          </div>
        </Kpi>
        <Kpi
          label="Kitchen right now"
          value={String(live?.active_orders ?? 0)}
          foot={
            kitchen.isError
              ? kitchen.error.message
              : live
                ? `${live.waiting} waiting · ${live.preparing} cooking · ${live.ready} ready`
                : ""
          }
          tone="#ff5c8a"
          href="/admin/kitchen"
          loading={kitchen.isLoading}
          delay={0.1}
        >
          <SegmentBar
            parts={[
              { label: "Waiting", value: live?.waiting ?? 0, tone: "#f6d15a" },
              { label: "Cooking", value: live?.preparing ?? 0, tone: "#ff5c8a" },
              { label: "Ready", value: live?.ready ?? 0, tone: "#3df28b" },
            ]}
          />
        </Kpi>
        <Kpi
          label="Shelf status"
          value={`${shelfCounts.in}/${shelf.length}`}
          foot={
            stock.isError
              ? stock.error.message
              : `${shelfCounts.in} in stock · ${shelfCounts.few} few left · ${shelfCounts.out} sold out`
          }
          tone="#f6d15a"
          href="/admin/stock"
          loading={stock.isLoading}
          delay={0.14}
        >
          <SegmentBar
            parts={[
              { label: "In stock", value: shelfCounts.in, tone: "#3df28b" },
              { label: "Few left", value: shelfCounts.few, tone: "#f6d15a" },
              { label: "Sold out", value: shelfCounts.out, tone: "#ff5c8a" },
            ]}
          />
        </Kpi>
      </section>

      <div className="mgr-row mgr-row-charts">
        <Card
          title="Demand"
          subtitle={`Portions ordered vs collected · last ${chartDays} days`}
          delay={0.16}
          action={
            <Link href="/admin/intelligence" className="mgr-link">
              Details
            </Link>
          }
        >
          {intel.isError ? (
            <CardError message={intel.error.message} onRetry={() => void intel.refetch()} />
          ) : intel.isLoading ? (
            <Skeleton className="mgr-skel-chart" />
          ) : (
            <>
              <div className="mgr-chart-legend">
                <span>
                  <i className="is-ordered" /> Ordered {demandDays.reduce((s, d) => s + d.ordered, 0)}
                </span>
                <span>
                  <i className="is-picked" /> Collected {demandDays.reduce((s, d) => s + d.picked, 0)}
                </span>
                <span className="mgr-muted">
                  {rangeDays < chartDays ? `${rangeOrdered} ordered · ${rangePicked} collected ${rangeName}` : ""}
                </span>
              </div>
              <DemandChart days={demandDays} />
            </>
          )}
        </Card>

        <Card title="Top dishes" subtitle={`Top 5 by portions ordered · last ${chartDays} days`} delay={0.2}>
          {intel.isError ? (
            <CardError message={intel.error.message} onRetry={() => void intel.refetch()} />
          ) : intel.isLoading ? (
            <Skeleton className="mgr-skel-chart" />
          ) : topSlices.length === 0 ? (
            <p className="mgr-empty">No orders in this period yet.</p>
          ) : (
            <Donut slices={topSlices} />
          )}
        </Card>
      </div>

      <div className="mgr-row mgr-row-ops">
        <Card
          title="Recent orders"
          subtitle={orders.data?.total != null ? `${orders.data.total} matching tickets` : "Latest tickets from the floor"}
          className="mgr-card-orders"
          delay={0.22}
          action={
            <Link href="/admin/orders" className="mgr-link">
              All orders
            </Link>
          }
        >
          <div className="mgr-orders-tools">
            <div className="mgr-tabs" role="tablist" aria-label="Order status">
              {ORDER_TABS.map((tab) => (
                <button
                  key={tab.value || "all"}
                  type="button"
                  role="tab"
                  aria-selected={orderStatus === tab.value}
                  className={cn(orderStatus === tab.value && "is-active")}
                  onClick={() => setOrderStatus(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <input
              className="mgr-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ticket, student, dish"
              aria-label="Search recent orders"
            />
          </div>
          {orders.isError ? (
            <CardError message={orders.error.message} onRetry={() => void orders.refetch()} />
          ) : (
            <div className={cn("mgr-table-wrap", orders.isPlaceholderData && "is-stale")}>
              <table className="mgr-table">
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Items</th>
                    <th scope="col">Status</th>
                    <th scope="col">Payment</th>
                    <th scope="col" className="is-num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.isLoading
                    ? Array.from({ length: 5 }, (_, index) => (
                        <tr key={index}>
                          <td colSpan={5}>
                            <Skeleton className="mgr-skel-line" />
                          </td>
                        </tr>
                      ))
                    : null}
                  {!orders.isLoading && visibleOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="mgr-empty">
                        {needle ? "No orders match your search." : "No orders with this status yet."}
                      </td>
                    </tr>
                  ) : null}
                  {visibleOrders.map((order) => {
                    const qty = order.items.reduce((sum, item) => sum + item.quantity, 0);
                    const names = order.items.map((item) => `${item.item_name} ×${item.quantity}`).join(", ");
                    return (
                      <tr key={order.id}>
                        <td>
                          <span className="mgr-ticket">{order.ticket_number}</span>
                          <span className="mgr-cell-sub">
                            {order.student_name ?? "Student"} · {timeLabel(order.created_at)}
                          </span>
                        </td>
                        <td>
                          <span className="mgr-items" title={names}>
                            {names || "—"}
                          </span>
                          <span className="mgr-cell-sub">
                            {qty} {qty === 1 ? "portion" : "portions"}
                          </span>
                        </td>
                        <td>
                          <span className={cn("mgr-badge", `is-${order.status.toLowerCase()}`)}>
                            {statusLabel(order.status)}
                          </span>
                        </td>
                        <td>
                          <span className={cn("mgr-badge", `is-pay-${order.payment.status.toLowerCase()}`)}>
                            {statusLabel(order.payment.status)}
                          </span>
                        </td>
                        <td className="is-num">{formatInrFromPaise(order.total_paise)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="mgr-stack">
          <Card
            title="Kitchen stations"
            subtitle={
              live
                ? `${cooking}/${capacity} slots cooking · avg prep ${minutes(live.average_observed_prep_seconds)}`
                : "Live load per line"
            }
            delay={0.26}
            action={
              <Link href="/admin/stations" className="mgr-link">
                Manage
              </Link>
            }
          >
            {kitchen.isError ? (
              <CardError message={kitchen.error.message} onRetry={() => void kitchen.refetch()} />
            ) : kitchen.isLoading ? (
              <Skeleton className="mgr-skel-block" />
            ) : stations.length === 0 ? (
              <p className="mgr-empty">No active stations. Open one so orders can be cooked.</p>
            ) : (
              <>
                <ul className="mgr-stations">
                  {busiestStations.map((station) => {
                    const load = station.parallel_capacity
                      ? Math.min(100, (station.in_progress / station.parallel_capacity) * 100)
                      : 0;
                    return (
                      <li key={station.id}>
                        <div className="mgr-station-row">
                          <span className="mgr-station-name">{station.name}</span>
                          <span className="mgr-station-meta">
                            {station.in_progress}/{station.parallel_capacity} cooking · {station.waiting} waiting
                          </span>
                        </div>
                        <div className="mgr-meter">
                          <span style={{ width: `${load}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {hiddenStations > 0 || pausedStations > 0 ? (
                  <p className="mgr-card-sub">
                    {hiddenStations > 0 ? `${hiddenStations} more idle stations` : ""}
                    {hiddenStations > 0 && pausedStations > 0 ? " · " : ""}
                    {pausedStations > 0 ? `${pausedStations} paused` : ""}
                  </p>
                ) : null}
              </>
            )}
          </Card>

          <Card
            title="Stock watch"
            subtitle="Dishes not marked In stock"
            delay={0.3}
            action={
              <Link href="/admin/stock" className="mgr-link">
                Update
              </Link>
            }
          >
            {stock.isError ? (
              <CardError message={stock.error.message} onRetry={() => void stock.refetch()} />
            ) : stock.isLoading ? (
              <Skeleton className="mgr-skel-block" />
            ) : shelfWatch.length === 0 ? (
              <p className="mgr-empty">Every active dish is in stock.</p>
            ) : (
              <ul className="mgr-watch">
                {shelfWatch.map((row) => (
                  <li key={row.id}>
                    <span>{row.name}</span>
                    <span className={cn("mgr-badge", row.level === "FEW_LEFT" ? "is-few" : "is-out")}>
                      {row.level === "FEW_LEFT" ? "Few left" : "Sold out"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
