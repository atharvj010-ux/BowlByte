"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useCart } from "@/components/cart/cart-provider";
import { apiFetch, readError, type CurrentUser } from "@/lib/auth";
import { formatInrFromPaise } from "@/lib/money";
import { canOrder, menuItemSchema, orderSchema } from "@/lib/ordering";

const menuResponse = z.object({ items: z.array(menuItemSchema), total: z.number() });
const ordersResponse = z.object({ orders: z.array(orderSchema) });

const openStatuses = new Set(["PLACED", "ACCEPTED", "QUEUED", "PREPARING", "READY", "UNCLAIMED"]);

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
  const available = (menu.data?.items ?? []).filter(canOrder);
  const active = (orders.data?.orders ?? []).filter((order) => openStatuses.has(order.status));
  const recent = (orders.data?.orders ?? []).slice(0, 3);

  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-3">
        <p className="text-xs tracking-[0.18em] text-chili uppercase">Student</p>
        <h1 className="font-display text-5xl leading-none tracking-tight">Hello, {user.full_name}</h1>
        <p className="text-muted-foreground" data-testid="account-name">
          Signed in as {user.full_name}.
        </p>
      </div>
      <Link
        href="/student/menu"
        className="flex min-h-28 flex-col justify-end rounded-[1.75rem] bg-chili p-6 text-ivory"
      >
        <span className="text-lime">Start here</span>
        <span className="font-display text-4xl">Browse food and place an order</span>
        <span className="mt-2 text-sm text-ivory/80">
          {menu.isLoading ? "Checking the counter." : `${available.length} dishes are available right now.`}
        </span>
      </Link>
      {active[0] ? (
        <Link href={`/student/orders/${active[0].id}`} className="block rounded-[1.5rem] bg-lime p-5 text-ink">
          <p className="text-xs tracking-[0.16em] uppercase">Active order</p>
          <p className="font-display text-3xl">{active[0].ticket_number}</p>
          <p className="text-sm">{active[0].status}</p>
        </Link>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/student/cart" className="rounded-[1.5rem] border border-border bg-card p-5">
          <p className="text-xs tracking-[0.16em] uppercase">Cart</p>
          <p className="font-display text-4xl">{cart.count}</p>
        </Link>
        <section className="rounded-[1.5rem] border border-border bg-card p-5">
          <h2 className="text-xs tracking-[0.16em] uppercase">Recent orders</h2>
          {orders.isLoading ? <p className="mt-2 text-sm">Loading orders.</p> : null}
          {recent.length === 0 && !orders.isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {recent.map((order) => (
                <li key={order.id}>
                  <Link href={`/student/orders/${order.id}`} className="underline-offset-4 hover:underline">
                    {order.ticket_number}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {order.status} · {formatInrFromPaise(order.total_paise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
