"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { addToCart, cartCount, loadCart, saveCart, type CartLine } from "@/lib/ordering";

type Flight = { id: number; src: string | null; name: string; from: DOMRect; to: DOMRect };

type CartApi = {
  count: number;
  lines: CartLine[];
  bump: boolean;
  /** Increments each time food lands in the cart, so badges can spring. */
  landed: number;
  add: (menuItemId: string, origin?: HTMLElement | null, image?: string | null, name?: string) => void;
};

const CartContext = createContext<CartApi | null>(null);
const MAX_FLIGHTS = 4;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function visibleCartTarget(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-cart-target]"));
  const visible = candidates.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  });
  return visible.at(-1) ?? null;
}

function onScreen(rect: DOMRect) {
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [bump, setBump] = useState(false);
  const [landed, setLanded] = useState(0);
  const [hint, setHint] = useState<{ id: number; name: string } | null>(null);
  const sequence = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const sync = () => setLines(loadCart());
    sync();
    window.addEventListener("bowlbyte-cart", sync);
    const pending = timers.current;
    return () => {
      window.removeEventListener("bowlbyte-cart", sync);
      pending.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const land = useCallback(() => {
    setLanded((value) => value + 1);
    setBump(true);
    later(() => setBump(false), 220);
  }, [later]);

  const add = useCallback<CartApi["add"]>(
    (menuItemId, origin, image, name) => {
      const next = addToCart(loadCart(), menuItemId, 1);
      saveCart(next);
      setLines(next);
      const id = ++sequence.current;
      setHint({ id, name: name ?? "Food" });
      later(() => setHint((current) => (current?.id === id ? null : current)), 1800);

      const target = visibleCartTarget();
      const source = origin?.querySelector<HTMLElement>("[data-food-image]") ?? origin ?? null;
      if (!source || !target || prefersReducedMotion()) {
        land();
        return;
      }
      const from = source.getBoundingClientRect();
      if (!onScreen(from)) {
        land();
        return;
      }
      const to = target.getBoundingClientRect();
      setFlights((current) => [...current.slice(-(MAX_FLIGHTS - 1)), { id, src: image ?? null, name: name ?? "Food", from, to }]);
    },
    [land, later],
  );

  const finish = useCallback(
    (id: number) => {
      setFlights((current) => current.filter((flight) => flight.id !== id));
      land();
    },
    [land],
  );

  const api = useMemo<CartApi>(
    () => ({ count: cartCount(lines), lines, bump, landed, add }),
    [add, bump, landed, lines],
  );

  return (
    <CartContext.Provider value={api}>
      {children}
      <span id="bowlbyte-cart-bump" data-bump={bump ? "on" : "off"} className="sr-only">
        {bump ? "Added to cart" : ""}
      </span>
      <div className="pointer-events-none fixed inset-0 z-50" aria-hidden="true">
        {flights.map((flight) => (
          <FoodFlight key={flight.id} flight={flight} onDone={() => finish(flight.id)} />
        ))}
      </div>
      <AnimatePresence>
        {hint ? (
          <motion.p
            key={hint.id}
            role="status"
            className="cart-hint"
            initial={{ y: -12, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            Added {hint.name}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </CartContext.Provider>
  );
}

function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function FoodFlight({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const { from, to } = flight;
  const size = Math.min(from.width, from.height, 220);
  const startX = from.left + from.width / 2 - size / 2;
  const startY = from.top + from.height / 2 - size / 2;
  const dx = to.left + to.width / 2 - (startX + size / 2);
  const dy = to.top + to.height / 2 - (startY + size / 2);
  const lift = Math.max(110, Math.min(window.innerHeight * 0.28, 220));
  const cx = dx * 0.2;
  const cy = Math.min(dy * 0.2, -24) - lift;
  const steps = 14;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = ease(i / steps);
    xs.push(2 * (1 - t) * t * cx + t * t * dx);
    ys.push(2 * (1 - t) * t * cy + t * t * dy);
  }
  const end = Math.max(0.12, Math.min(to.height, to.width) / size);
  const times = xs.map((_, i) => i / steps);

  return (
    <motion.div
      className="food-flight"
      data-testid="food-flight"
      style={{ left: startX, top: startY, width: size, height: size }}
      initial={{ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }}
      animate={{
        x: xs,
        y: ys,
        scale: [1, 1.08, 0.9, end],
        rotate: [0, -10, 6, 18],
        opacity: [1, 1, 1, 0.35],
      }}
      transition={{
        duration: 0.82,
        ease: "linear",
        x: { duration: 0.82, ease: "linear", times },
        y: { duration: 0.82, ease: "linear", times },
        scale: { duration: 0.82, times: [0, 0.18, 0.6, 1], ease: "easeInOut" },
        rotate: { duration: 0.82, times: [0, 0.25, 0.6, 1], ease: "easeInOut" },
        opacity: { duration: 0.82, times: [0, 0.6, 0.85, 1] },
      }}
      onAnimationComplete={onDone}
    >
      {flight.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={flight.src} alt="" />
      ) : (
        <span className="food-flight-mark">{flight.name.slice(0, 1)}</span>
      )}
    </motion.div>
  );
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) {
    throw new Error("CartProvider is missing");
  }
  return value;
}
