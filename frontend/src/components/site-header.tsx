"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";

import { useCart } from "@/components/cart/cart-provider";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { SESSION_EPOCH_KEY } from "@/components/session-privacy";
import { clearPrivateBrowserState, isAuthScreen } from "@/lib/session-privacy";
import { apiFetch, fetchCurrentUser, roleLabel, type CurrentUser } from "@/lib/auth";
import { releaseDeviceForLogout } from "@/lib/push";

const sectionsByRole: Record<CurrentUser["role"], { href: string; label: string }[]> = {
  STUDENT: [
    { href: "/student", label: "Home" },
    { href: "/student/menu", label: "Menu" },
    { href: "/student/orders", label: "Orders" },
    { href: "/student/profile", label: "Profile" },
  ],
  KITCHEN_STAFF: [
    { href: "/staff", label: "Kitchen" },
    { href: "/staff/queue", label: "Queue" },
  ],
  CASHIER: [
    { href: "/cashier", label: "Desk" },
    { href: "/cashier/history", label: "History" },
  ],
  // Every manager section is in the manager sidebar and section bar, which stay on screen across /admin.
  CANTEEN_MANAGER: [{ href: "/admin", label: "Home" }],
};

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
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchCurrentUser });
  const cart = useCart();
  const account = isAuthScreen(pathname) ? null : me.data;

  async function logout() {
    if (account?.role === "STUDENT") {
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

  const sections = account ? sectionsByRole[account.role] : [];
  const links = sections.map((section) => (
    <Link key={section.href} href={section.href} className={navLinkClass}>
      {section.label}
    </Link>
  ));

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-display text-xl font-extrabold tracking-tight uppercase">
          <BowlMark />
          BowlByte
        </Link>
        {account ? (
          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {links}
          </nav>
        ) : null}
        {account?.role === "STUDENT" ? (
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
            <motion.span
              className="inline-flex"
              initial={{ opacity: 0, y: -14, scale: 0.7 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 480, damping: 16, delay: 0.12 }}
            >
              <NotificationBell />
            </motion.span>
          </>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          {account ? (
            <>
              <span className="hidden max-w-48 truncate text-sm lg:inline">
                {account.full_name}
                <span className="text-muted-foreground"> · {roleLabel(account.role)}</span>
              </span>
              <Button type="button" variant="outline" className="hidden lg:inline-flex" onClick={logout}>
                Log out
              </Button>
              <details className="relative lg:hidden">
                <summary className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-card text-sm sm:px-4">
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 sm:hidden">
                    <path
                      d="M3 6h14M3 10h14M3 14h14"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="max-sm:sr-only">Menu</span>
                </summary>
                <nav
                  aria-label="Mobile"
                  className="absolute right-0 mt-2 flex w-56 flex-col rounded-2xl border border-border bg-card p-2 shadow-lg"
                >
                  {links}
                  <button type="button" className={navLinkClass} onClick={logout}>
                    Log out
                  </button>
                </nav>
              </details>
            </>
          ) : isAuthScreen(pathname) ? null : (
            // One header CTA only. A separate mobile duplicate sat in the flex
            // row and showed as a second "Get started now" on some laptop widths.
            <Link href="/login" className="pill pill-solid">
              Get started now
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
