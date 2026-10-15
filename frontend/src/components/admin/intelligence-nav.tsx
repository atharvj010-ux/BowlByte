import Link from "next/link";

const links = [
  ["/admin/intelligence", "Overview"],
  ["/admin/intelligence/forecasts", "Forecasts"],
  ["/admin/intelligence/planning", "Planning"],
  ["/admin/intelligence/history", "History"],
  ["/admin/production", "Production"],
  ["/admin/waste", "Waste"],
] as const;

export function IntelligenceNav() {
  return (
    <nav className="mb-8 flex flex-wrap gap-3 text-sm" aria-label="Food intelligence">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="rounded-full border border-border px-3 py-1 hover:bg-muted">
          {label}
        </Link>
      ))}
    </nav>
  );
}
