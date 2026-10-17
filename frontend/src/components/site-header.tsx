"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";

import { useCart } from "@/components/cart/cart-provider";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { SESSION_EPOCH_KEY } from "@/components/session-privacy";
import { clearPrivateBrowserState } from "@/lib/session-privacy";
import { apiFetch, fetchCurrentUser, roleLabel } from "@/lib/auth";
import { roles } from "@/lib/content";
import { releaseDeviceForLogout } from "@/lib/push";

function BowlMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="h-8 w-8">
      <rect width="32" height="32" rx="10" fill="#f15438" />
      <path d="M7 14h18c0 6.2-4 11-9 11s-9-4.8-9-11z" fill="#f4eddd" />
      <path d="M10 14c1.4-3.2 10.6-3.2 12 0" fill="none" stroke="#191919" strokeWidth="1.6" />
    </svg>
  );
}

const navLinkClass =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm text-foreground/80 hover:bg-secondary hover:text-foreground";

export function SiteHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });
  const cart = useCart();

  async function logout() {
    if (me.data?.role === "STUDENT") {
      // Stop pushes to this device before the session ends, so the next person gets nothing.
      await releaseDeviceForLogout();
    }
    await apiFetch("/api/v1/auth/logout", { method: "POST" });
    queryClient.clear();
    clearPrivateBrowserState();
    window.localStorage.setItem(SESSION_EPOCH_KEY, String(Date.now()));
    router.push("/");
    router.refresh();
  }

  const links = (
    <>
      <Link href="/status" className={navLinkClass}>
        Status
      </Link>
      {roles.map((role) => (
        <Link key={role.href} href={role.href} className={navLinkClass}>
          {role.navLabel}
        </Link>
      ))}
      <Link href="/student/register" className={navLinkClass}>
        Register
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-display text-xl font-extrabold tracking-tight uppercase">
          <BowlMark />
          BowlByte
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {links}
        </nav>
        {me.data?.role === "STUDENT" ? (
          <>
            <Link
              id="bowlbyte-cart-target"
              data-cart-target=""
              data-bump={cart.bump ? "on" : "off"}
              href="/student/cart"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-chili pr-1.5 pl-3 text-sm font-semibold text-ivory sm:pl-4"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 sm:hidden">
                <path d="M4 7h12l-1 10H5L4 7zM7 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
              <span className="max-sm:sr-only">Cart</span>{" "}
              <motion.span
                key={cart.landed}
                className="grid min-h-8 min-w-8 place-items-center rounded-full bg-ivory px-2 text-ink"
                initial={cart.landed ? { scale: 1.5, rotate: -12 } : false}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 520, damping: 14 }}
              >
                {cart.count}
              </motion.span>
            </Link>
            <NotificationBell />
          </>
        ) : null}
        <div className="hidden min-w-0 items-center gap-2 lg:flex">
          {me.data ? (
            <>
              <span className="max-w-48 truncate text-sm">
                {me.data.full_name}
                <span className="text-muted-foreground"> · {roleLabel(me.data.role)}</span>
              </span>
              <Button type="button" variant="outline" onClick={logout}>
                Log out
              </Button>
            </>
          ) : (
            <Link href="/student/login" className={navLinkClass}>
              Sign in
            </Link>
          )}
        </div>
        <details className="relative lg:hidden">
          <summary className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-card text-sm sm:px-4">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 sm:hidden">
              <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="max-sm:sr-only">Menu</span>
          </summary>
          <nav
            aria-label="Mobile"
            className="absolute right-0 mt-2 flex w-56 flex-col rounded-2xl border border-border bg-card p-2 shadow-lg"
          >
            {links}
            {me.data ? (
              <button type="button" className={navLinkClass} onClick={logout}>
                Log out
              </button>
            ) : (
              <Link href="/student/login" className={navLinkClass}>
                Sign in
              </Link>
            )}
          </nav>
        </details>
      </div>
    </header>
  );
}
