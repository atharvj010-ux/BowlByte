import type { ReactNode } from "react";

import { stateBadge, type CounterOrder } from "@/lib/cash";
import { formatInrFromPaise } from "@/lib/money";

const toneClass = {
  pending: "border-accent bg-accent/15 text-foreground",
  paid: "border-primary bg-primary/15 text-foreground",
  done: "border-border bg-muted text-muted-foreground",
} as const;

export function StateBadge({ order }: { order: Pick<CounterOrder, "status" | "payment"> }) {
  const badge = stateBadge(order);
  return (
    <span
      data-testid="state-badge"
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${toneClass[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}

export function OrderCard({
  order,
  children,
  highlight = false,
}: {
  order: CounterOrder;
  children?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <li
      data-testid="counter-order"
      data-ticket={order.ticket_number}
      data-status={order.status}
      data-payment={order.payment.status}
      className={`space-y-2 rounded-2xl border p-4 ${highlight ? "border-primary bg-card shadow-md" : "border-border bg-card"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-3xl leading-none">{order.ticket_number}</p>
          <p className="text-sm text-muted-foreground">
            {order.student_first_name ?? "Student"} · {formatInrFromPaise(order.total_paise)} cash
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Order {order.status === "PICKED_UP" ? "picked up" : order.status.toLowerCase()}
          </span>
          <StateBadge order={order} />
        </div>
      </div>
      <ul className="text-sm">
        {order.items.map((item) => (
          <li key={item.item_name}>
            {item.item_name} × {item.quantity}
          </li>
        ))}
      </ul>
      {order.payment.receipt_ref ? (
        <p className="text-xs text-muted-foreground">Receipt {order.payment.receipt_ref}</p>
      ) : null}
      {children}
    </li>
  );
}
