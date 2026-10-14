import Link from "next/link";

import { roles } from "@/lib/content";

function BowlMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="h-8 w-8">
      <rect width="32" height="32" rx="10" fill="#1d6b64" />
      <path d="M7 14h18c0 6.2-4 11-9 11s-9-4.8-9-11z" fill="#f4efe6" />
      <path d="M10 14c1.4-3.2 10.6-3.2 12 0" fill="none" stroke="#e07a2f" strokeWidth="1.6" />
    </svg>
  );
}

const navLinkClass =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm text-foreground/80 hover:bg-secondary hover:text-foreground";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-display text-xl">
          <BowlMark />
          BowlByte
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          <Link href="/status" className={navLinkClass}>
            Status
          </Link>
          {roles.map((role) => (
            <Link key={role.href} href={role.href} className={navLinkClass}>
              {role.navLabel}
            </Link>
          ))}
        </nav>
        <details className="relative md:hidden">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-full border border-border bg-card px-4 text-sm">
            Menu
          </summary>
          <nav
            aria-label="Mobile"
            className="absolute right-0 mt-2 flex w-48 flex-col rounded-2xl border border-border bg-card p-2 shadow-lg"
          >
            <Link href="/status" className={navLinkClass}>
              Status
            </Link>
            {roles.map((role) => (
              <Link key={role.href} href={role.href} className={navLinkClass}>
                {role.navLabel}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
