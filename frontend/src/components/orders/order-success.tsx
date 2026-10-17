"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { KineticText } from "@/components/motion/kinetic";
import { foodImage, showcase } from "@/lib/food-art";
import { formatInrFromPaise } from "@/lib/money";
import type { CanteenOrder, MenuItem } from "@/lib/ordering";

const spots = [
  { left: "6%", top: "8%", rotate: -14 },
  { left: "76%", top: "4%", rotate: 12 },
  { left: "2%", top: "46%", rotate: 8 },
  { left: "80%", top: "44%", rotate: -10 },
];

const sparkTones = ["#d5f25b", "#f15438", "#4aa8ff", "#ff5c8a", "#f6d15a", "#f4eddd"];

/** Shown only after the server returned the placed order. */
export function OrderSuccess({
  order,
  items = [],
  onTrack,
  onMenu,
}: {
  order: CanteenOrder;
  items?: MenuItem[];
  onTrack: () => void;
  onMenu: () => void;
}) {
  const [reduced, setReduced] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    const timer = window.setTimeout(() => setDone(true), 2800);
    return () => {
      media.removeEventListener("change", apply);
      window.clearTimeout(timer);
    };
  }, []);
  const quiet = reduced || skipped;
  const pictures = useMemo(() => {
    const found = items.flatMap((item) => {
      const picture = foodImage(item);
      return picture ? [picture.src] : [];
    });
    const unique = Array.from(new Set(found));
    const fill = [showcase.fries.small, showcase.coldCoffee.small, showcase.burger.small, showcase.samosa.small];
    return [...unique, ...fill].slice(0, 4);
  }, [items]);
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const at = (seconds: number) => (quiet ? 0 : seconds);

  return (
    <section className="success" data-testid="order-success" data-motion={quiet ? "off" : "on"}>
      {!quiet && !done ? (
        <button type="button" className="chip-btn absolute top-4 right-4 z-10" onClick={() => setSkipped(true)}>
          Skip
        </button>
      ) : null}
      <div className="relative grid w-full max-w-3xl justify-items-center gap-6">
        <div className="relative grid min-h-[22rem] w-full place-items-center">
          {pictures.map((src, index) => (
            <motion.img
              key={`${src}-${index}`}
              src={src}
              alt=""
              className="success-food"
              style={{ left: spots[index].left, top: spots[index].top }}
              initial={quiet ? false : { x: index % 2 ? 260 : -260, y: index < 2 ? -200 : 200, scale: 0.3, rotate: spots[index].rotate * 4, opacity: 0 }}
              animate={{ x: 0, y: 0, scale: 1, rotate: spots[index].rotate, opacity: 1 }}
              transition={{ type: "spring", stiffness: 120, damping: 15, delay: at(0.08 * index) }}
            />
          ))}
          {quiet
            ? null
            : Array.from({ length: 18 }, (_, index) => {
                const angle = (index / 18) * Math.PI * 2;
                const distance = 140 + (index % 3) * 50;
                return (
                  <motion.span
                    key={index}
                    className="success-spark"
                    style={{ background: sparkTones[index % sparkTones.length] }}
                    initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                    animate={{
                      x: Math.cos(angle) * distance,
                      y: Math.sin(angle) * distance * 0.6,
                      scale: [0, 1.4, 0.4],
                      opacity: [0, 1, 0],
                    }}
                    transition={{ duration: 1.2, delay: 0.35 + (index % 4) * 0.04, ease: "easeOut" }}
                  />
                );
              })}
          <div className="relative z-[2] grid justify-items-center gap-3 px-2">
          <p className="eyebrow">Order received</p>
          <KineticText
            as="p"
            mode="load"
            delay={quiet ? 0 : 420}
            lines={["ORDER IN.", "HAPPINESS LOADING."]}
            className="success-words"
          />
          <p className="text-center text-ivory/80">Your kitchen has received your order. It is not ready yet.</p>
          </div>
        </div>
        <motion.article
          className="ticket"
          data-testid="order-ticket"
          initial={quiet ? false : { y: 140, rotate: -8, opacity: 0 }}
          animate={{ y: 0, rotate: -1.5, opacity: 1 }}
          transition={{ type: "spring", stiffness: 110, damping: 14, delay: at(1.45) }}
        >
          <div className="flex items-center justify-between font-mono text-[0.68rem] tracking-[0.16em] uppercase">
            <span>BowlByte</span>
            <span>Ticket</span>
          </div>
          <h2 className="mt-2 font-display text-6xl leading-none font-extrabold tracking-tight">{order.ticket_number}</h2>
          <ul className="mt-3 grid gap-1 text-sm">
            {order.items.map((item) => (
              <li key={item.menu_item_id} className="flex justify-between gap-3">
                <span className="truncate">
                  {item.item_name} × {item.quantity}
                </span>
                <span>{formatInrFromPaise(item.line_total_paise)}</span>
              </li>
            ))}
          </ul>
          <div className="ticket-tear" />
          <div className="flex items-baseline justify-between">
            <span className="text-sm">
              {count} {count === 1 ? "item" : "items"}
            </span>
            <span className="font-display text-2xl font-extrabold">{formatInrFromPaise(order.total_paise)}</span>
          </div>
          <p className="mt-3 flex flex-wrap gap-2" data-testid="order-payment">
            <span className="ticket-stamp">{order.status}</span>
            <span className="sr-only"> · </span>
            <span className="ticket-stamp">{order.payment.method}</span>
            <span className="sr-only"> · </span>
            <span className="ticket-stamp">{order.payment.status}</span>
          </p>
        </motion.article>
        <motion.div
          className="flex flex-wrap justify-center gap-3"
          initial={quiet ? false : { y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: at(2.1) }}
        >
          <button type="button" className="pill pill-solid min-h-13! px-7! text-base uppercase" onClick={onTrack}>
            Track my order
          </button>
          <button type="button" className="pill pill-ghost" onClick={onMenu}>
            Back to menu
          </button>
        </motion.div>
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
