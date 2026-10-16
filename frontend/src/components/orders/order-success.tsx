"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { formatInrFromPaise } from "@/lib/money";
import type { CanteenOrder } from "@/lib/ordering";

export function OrderSuccess({ order, onTrack, onMenu }: { order: CanteenOrder; onTrack: () => void; onMenu: () => void }) {
  const [reduced, setReduced] = useState(false);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  const quiet = reduced || skipped;
  return (
    <section className="order-success" data-testid="order-success" data-motion={quiet ? "off" : "on"}>
      {quiet ? null : (
        <div className="order-burst" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <p className="text-xs tracking-[0.22em] text-lime uppercase">BowlByte</p>
      <p className="font-display text-5xl leading-[0.9] tracking-tight">
        Order in.
        <br />
        Happiness loading.
      </p>
      <p>Your kitchen has received your order. It is not ready yet.</p>
      <article className={quiet ? "order-ticket" : "order-ticket order-ticket-in"} data-testid="order-ticket">
        <p className="text-xs tracking-[0.16em] uppercase">Ticket</p>
        <h2 className="font-display text-4xl">{order.ticket_number}</h2>
        <p>
          {order.items.reduce((sum, item) => sum + item.quantity, 0)} items · {formatInrFromPaise(order.total_paise)}
        </p>
        <p data-testid="order-payment">
          {order.status} · {order.payment.method} · {order.payment.status}
        </p>
      </article>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="min-h-11 rounded-full bg-chili px-5 text-ivory" onClick={onTrack}>
          Track my order
        </button>
        <button type="button" className="min-h-11 rounded-full border border-border px-5" onClick={onMenu}>
          Back to menu
        </button>
        {quiet ? null : (
          <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setSkipped(true)}>
            Skip
          </button>
        )}
      </div>
    </section>
  );
}

export function useOrderRoute() {
  const router = useRouter();
  return {
    track: (id: string) => router.push(`/student/orders/${id}`),
    menu: () => router.push("/student/menu"),
  };
}
