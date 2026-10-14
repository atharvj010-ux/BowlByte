import type { ReactNode } from "react";

import { formatInrFromPaise } from "@/lib/money";
import { canOrder, type MenuItem } from "@/lib/ordering";

export function MenuCard({
  item,
  action,
}: {
  item: MenuItem;
  action?: ReactNode;
}) {
  const orderable = canOrder(item);
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_40px_-32px_rgba(28,22,18,0.55)]">
      {item.image_url ? (
        // Menu photos are same-origin bytes served by the API.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_url} alt="" className="h-36 w-full object-cover" />
      ) : (
        <div className="flex h-36 items-end bg-[linear-gradient(160deg,#1d6b64,#e07a2f)] p-4 text-primary-foreground">
          <span className="font-display text-2xl">{item.name.slice(0, 1)}</span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-2xl leading-tight">{item.name}</h3>
          <p className="text-sm font-medium">{formatInrFromPaise(item.price_paise)}</p>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          {item.category_name}
          {orderable ? ` · ${item.available_qty} left` : " · Unavailable"}
        </p>
        {action}
      </div>
    </article>
  );
}
