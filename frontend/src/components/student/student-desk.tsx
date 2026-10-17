"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useCart } from "@/components/cart/cart-provider";
import { PushSettings } from "@/components/notifications/push-settings";
import { categoryTone, FoodPicture } from "@/components/menu/menu-card";
import { KineticText } from "@/components/motion/kinetic";
import { apiFetch, readError, type CurrentUser } from "@/lib/auth";
import { showcase } from "@/lib/food-art";
import { formatInrFromPaise } from "@/lib/money";
import { canOrder, menuItemSchema, orderSchema } from "@/lib/ordering";

const menuResponse = z.object({ items: z.array(menuItemSchema), total: z.number() });
const ordersResponse = z.object({ orders: z.array(orderSchema) });

const openStatuses = new Set(["PLACED", "ACCEPTED", "QUEUED", "PREPARING", "READY", "UNCLAIMED"]);

const collage = [
  { art: showcase.burger, className: "left-[48%] top-[-6%] w-[46%]", delay: 0 },
  { art: showcase.dosa, className: "left-[22%] top-[34%] w-[52%]", delay: 0.08 },
  { art: showcase.coldCoffee, className: "left-[70%] top-[30%] w-[34%]", delay: 0.16 },
];

export function StudentDesk({ user }: { user: CurrentUser }) {
  const cart = useCart();
  const menu = useQuery({
    queryKey: ["menu", "home"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/menu/items?limit=12");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return menuResponse.parse(await response.json());
    },
  });
  const orders = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/orders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      return ordersResponse.parse(await response.json());
    },
  });
  const available = (menu.isSuccess ? menu.data.items : []).filter(canOrder);
  const ownOrders = orders.isSuccess ? orders.data.orders : [];
  const active = ownOrders.filter((order) => openStatuses.has(order.status));
  const recent = ownOrders.slice(0, 3);

  return (
    <div className="space-y-8">
      <div className="max-w-3xl space-y-3">
        <p className="eyebrow">Student</p>
        <KineticText
          as="h1"
          mode="load"
          lines={[`Hello, ${user.full_name}`]}
          className="text-[clamp(2.4rem,7vw,5rem)] leading-[0.88] tracking-[-0.045em]"
        />
        <p className="text-muted-foreground" data-testid="account-name">
          Signed in as {user.full_name}.
        </p>
      </div>

      <Link
        href="/student/menu"
        className="group relative grid min-h-72 overflow-hidden rounded-[2rem] border border-white/5 p-6 sm:min-h-80 sm:grid-cols-[1fr_1.1fr] sm:p-8"
        style={{
          background:
            "radial-gradient(60% 80% at 80% 40%, rgba(109,76,224,0.5), transparent 70%), linear-gradient(135deg, #f15438 0%, #b8321f 55%, #2a1630 100%)",
        }}
      >
        <div className="relative z-10 flex flex-col justify-end gap-2">
          <span className="eyebrow text-ivory!">Start here</span>
          <span className="font-display text-4xl leading-[0.9] font-extrabold tracking-tight text-ivory uppercase sm:text-5xl">
            Browse food and place an order
          </span>
          <span className="text-sm text-ivory/85">
            {menu.isLoading ? "Checking the counter." : `${available.length} dishes are available right now.`}
          </span>
          <span className="pill pill-solid mt-3 w-fit">Explore menu</span>
        </div>
        <div className="relative mt-4 h-52 sm:mt-0 sm:h-auto" aria-hidden="true">
          {collage.map((piece) => (
            <motion.img
              key={piece.art.dish}
              src={piece.art.small}
              alt=""
              className={`absolute ${piece.className} transition-transform duration-500 group-hover:-translate-y-2 [mask-image:radial-gradient(closest-side,#000_64%,transparent_100%)]`}
              initial={{ y: 40, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 120, damping: 16, delay: 0.2 + piece.delay }}
            />
          ))}
          <span className="food-art-tag right-0 bottom-0 left-auto!">Illustrative images</span>
        </div>
      </Link>

      {active[0] ? (
        <Link
          href={`/student/orders/${active[0].id}`}
          className="flex items-center justify-between gap-4 rounded-[1.6rem] bg-lime p-5 text-ink"
        >
          <div>
            <p className="font-mono text-[0.68rem] tracking-[0.16em] uppercase">Active order</p>
            <p className="font-display text-4xl font-extrabold">{active[0].ticket_number}</p>
            <p className="text-sm">{active[0].status}</p>
          </div>
          <span className="pill bg-ink text-ivory">Track</span>
        </Link>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
        <Link href="/student/cart" className="rounded-[1.6rem] border border-border bg-card p-5">
          <p className="eyebrow">Cart</p>
          <p className="font-display text-6xl font-extrabold">{cart.count}</p>
          <p className="text-sm text-muted-foreground">You pay in cash when you collect.</p>
        </Link>
        <section className="rounded-[1.6rem] border border-border bg-card p-5">
          <h2 className="eyebrow">Recent orders</h2>
          {orders.isLoading ? <p className="mt-2 text-sm">Loading orders.</p> : null}
          {orders.isError ? (
            <p className="mt-2 text-sm text-destructive" data-testid="orders-denied">
              {orders.error.message}
            </p>
          ) : null}
          {orders.isSuccess && recent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No orders yet.</p>
          ) : null}
          {orders.isSuccess && recent.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {recent.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3">
                  <Link href={`/student/orders/${order.id}`} className="font-display text-lg font-bold underline-offset-4 hover:underline">
                    {order.ticket_number}
                  </Link>
                  <span className="text-muted-foreground">
                    {order.status} · {formatInrFromPaise(order.total_paise)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <PushSettings userId={user.id} />

      {available.length > 0 ? (
        <section className="space-y-3" aria-labelledby="counter-now">
          <div className="flex items-end justify-between gap-3">
            <h2 id="counter-now" className="font-display text-3xl font-extrabold tracking-tight uppercase">
              On the counter now
            </h2>
            <Link href="/student/menu" className="text-sm text-lime underline-offset-4 hover:underline">
              See all
            </Link>
          </div>
          <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
            {available.slice(0, 8).map((item) => (
              <li key={item.id} className="w-44 flex-none snap-start">
                <Link
                  href="/student/menu"
                  className="block overflow-hidden rounded-[1.4rem] border border-border bg-card"
                  style={{ ["--tone" as string]: categoryTone(item.category_name) }}
                >
                  <span className="food-card-media block">
                    <FoodPicture item={item} className="food-card-photo" />
                  </span>
                  <span className="block p-3">
                    <span className="block truncate font-semibold">{item.name}</span>
                    <span className="text-sm text-[#ff8a70]">{formatInrFromPaise(item.price_paise)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
