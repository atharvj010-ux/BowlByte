"use client";

import "./manager-desk.css";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; blurb: string; tone: string };

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", blurb: "Live overview", tone: "#4aa8ff" },
  { href: "/admin/orders", label: "Orders", blurb: "Every ticket", tone: "#ff5c8a" },
  { href: "/admin/kitchen", label: "Kitchen", blurb: "Queue and readiness", tone: "#3df28b" },
  { href: "/admin/cash", label: "Cash", blurb: "Receipts and voids", tone: "#d5f25b" },
  { href: "/admin/menu", label: "Menu", blurb: "Dishes, prices, photos", tone: "#f15438" },
  { href: "/admin/stock", label: "Stock", blurb: "In stock · few · out", tone: "#f6d15a" },
  { href: "/admin/stations", label: "Stations", blurb: "Lines and capacity", tone: "#3df28b" },
  { href: "/admin/staff", label: "Staff", blurb: "Invites and access", tone: "#ff8d7a" },
  { href: "/admin/intelligence", label: "Intelligence", blurb: "Forecasts and plans", tone: "#4aa8ff" },
  { href: "/admin/production", label: "Production", blurb: "What was cooked", tone: "#f6d15a" },
  { href: "/admin/waste", label: "Waste", blurb: "Discard records", tone: "#ff8d7a" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ManagerShell({ name, children }: { name: string; children: ReactNode }) {
  const pathname = usePathname();
  const chipsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const strip = chipsRef.current;
    const active = strip?.querySelector<HTMLElement>(".is-active");
    if (!strip || !active) {
      return;
    }
    const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [pathname]);

  return (
    <div className="mgr" data-testid="manager-shell">
      <aside className="mgr-side">
        <div className="mgr-side-who">
          <span className="mgr-side-avatar" aria-hidden="true">
            {name.trim().charAt(0).toUpperCase() || "M"}
          </span>
          <span className="min-w-0">
            <span className="mgr-side-name">{name}</span>
            <span className="mgr-side-role">Canteen manager</span>
          </span>
        </div>
        <p className="mgr-side-kicker">Manage canteen</p>
        <nav className="mgr-side-nav" aria-label="Manager sections">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("mgr-side-link", active && "is-active")}
                style={{ ["--tone" as string]: item.tone }}
                aria-current={active ? "page" : undefined}
              >
                <span className="mgr-side-dot" aria-hidden="true" />
                <span>
                  <span className="mgr-side-label">{item.label}</span>
                  <span className="mgr-side-blurb">{item.blurb}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="mgr-main">
        <nav ref={chipsRef} className="mgr-chips" aria-label="Manager sections">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("mgr-chip", active && "is-active")}
                style={{ ["--tone" as string]: item.tone }}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mgr-content">{children}</div>
      </div>
    </div>
  );
}
