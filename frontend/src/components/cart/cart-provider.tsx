"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { addToCart, cartCount, loadCart, saveCart, type CartLine } from "@/lib/ordering";

type Flight = { id: number; src: string | null; name: string; from: DOMRect; to: DOMRect };

type CartApi = {
  count: number;
  lines: CartLine[];
  bump: boolean;
  add: (menuItemId: string, origin?: HTMLElement | null, image?: string | null, name?: string) => void;
};

const CartContext = createContext<CartApi | null>(null);

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    const sync = () => setLines(loadCart());
    sync();
    window.addEventListener("bowlbyte-cart", sync);
    return () => window.removeEventListener("bowlbyte-cart", sync);
  }, []);

  const api = useMemo<CartApi>(
    () => ({
      count: cartCount(lines),
      lines,
      bump,
      add: (menuItemId, origin, image, name) => {
        const next = addToCart(loadCart(), menuItemId, 1);
        saveCart(next);
        setLines(next);
        const target = document.getElementById("bowlbyte-cart-target");
        if (!origin || !target || prefersReducedMotion()) {
          setBump(true);
          window.setTimeout(() => setBump(false), 180);
          return;
        }
        const from = origin.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const id = Date.now();
        setFlight({ id, src: image ?? null, name: name ?? "Food", from, to });
        window.setTimeout(() => {
          setFlight((current) => (current?.id === id ? null : current));
          setBump(true);
          window.setTimeout(() => setBump(false), 180);
        }, 560);
      },
    }),
    [bump, lines],
  );

  return (
    <CartContext.Provider value={api}>
      {children}
      <span id="bowlbyte-cart-bump" data-bump={bump ? "on" : "off"} className="sr-only">
        {bump ? "Added to cart" : ""}
      </span>
      {flight ? (
        <div className="pointer-events-none fixed inset-0 z-50" aria-hidden="true">
          <div
            className="food-flight"
            style={{
              left: flight.from.left,
              top: flight.from.top,
              width: flight.from.width,
              height: flight.from.height,
              ["--fly-x" as string]: `${flight.to.left - flight.from.left + flight.to.width / 2 - flight.from.width / 2}px`,
              ["--fly-y" as string]: `${flight.to.top - flight.from.top}px`,
            }}
          >
            {flight.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={flight.src} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="food-flight-mark">{flight.name.slice(0, 1)}</span>
            )}
          </div>
        </div>
      ) : null}
    </CartContext.Provider>
  );
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) {
    throw new Error("CartProvider is missing");
  }
  return value;
}
