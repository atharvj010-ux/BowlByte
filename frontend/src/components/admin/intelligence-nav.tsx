"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  ["/admin/intelligence", "Overview"],
  ["/admin/intelligence/forecasts", "Forecasts"],
  ["/admin/intelligence/planning", "Planning"],
  ["/admin/intelligence/history", "History"],
  ["/admin/production", "Production"],
  ["/admin/waste", "Waste"],
] as const;

export function IntelligenceNav() {
  const pathname = usePathname();
  return (
    <nav className="mgr-subnav" aria-label="Food intelligence">
      {links.map(([href, label]) => {
        const active = pathname === href;
        return (
          <Link key={href} href={href} className={cn(active && "is-active")} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
