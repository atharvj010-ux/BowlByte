import type { ReactNode } from "react";

import { stateBadge, type CounterOrder } from "@/lib/cash";
import { formatInrFromPaise } from "@/lib/money";

const toneClass = {
  pending: "cashier-badge-pending",
  paid: "cashier-badge-paid",
  done: "cashier-badge-done",
} as const;

export function StateBadge({ order }: { order: Pick<CounterOrder, "status" | "payment"> }) {
  const badge = stateBadge(order);
  return (
    <span data-testid="state-badge" className={`cashier-badge ${toneClass[badge.tone]}`}>
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
      className={`cashier-order ${highlight ? "cashier-order-active" : ""}`}
      data-tone={order.payment.status === "PAID" ? "paid" : "pending"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-3xl leading-none tracking-tight">{order.ticket_number}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {order.student_first_name ?? "Student"} · {formatInrFromPaise(order.total_paise)} cash
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[0.65rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Order {order.status === "PICKED_UP" ? "picked up" : order.status.toLowerCase()}
          </span>
          <StateBadge order={order} />
        </div>
      </div>
      <ul className="cashier-order-items text-sm">
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
