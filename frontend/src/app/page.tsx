import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fulfillmentExits,
  fulfillmentPath,
  operatingRules,
  releaseNotes,
  roles,
} from "@/lib/content";

export const metadata: Metadata = {
  title: "BowlByte",
  description:
    "Counter-pickup canteen operations for students, kitchen staff, cashiers, and managers. Cash payments only.",
};

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="space-y-6">
          <p className="text-xs font-medium tracking-[0.2em] text-primary uppercase">
            College canteen operations
          </p>
          <h1 className="font-display text-4xl leading-[1.05] text-balance sm:text-6xl">
            The counter, the kitchen, and the cash drawer.
          </h1>
          <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            BowlByte is the foundation for one pilot canteen. Students will order ahead, the
            kitchen will work a real queue, and cashiers will confirm cash before anything is
            marked collected.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/student">Open the student area</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/status">Check service status</Link>
            </Button>
          </div>
        </div>
        <aside className="relative rounded-[1.75rem] border border-border bg-card px-6 py-7 shadow-[0_24px_60px_-36px_rgba(28,22,18,0.6)]">
          <div className="absolute top-1/2 -left-3 h-6 w-6 -translate-y-1/2 rounded-full border border-border bg-background" />
          <div className="absolute top-1/2 -right-3 h-6 w-6 -translate-y-1/2 rounded-full border border-border bg-background" />
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Operating rule
          </p>
          <p className="mt-3 font-display text-4xl leading-none">Cash at the counter</p>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-dashed border-border pb-3">
              <dt className="text-muted-foreground">Method</dt>
              <dd className="font-medium">CASH</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-dashed border-border pb-3">
              <dt className="text-muted-foreground">Starts as</dt>
              <dd className="font-medium">PENDING</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Collected only when</dt>
              <dd className="font-medium">PAID</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">
            Amounts will be stored as integer paise. This card is a rule, not a live order.
          </p>
        </aside>
      </section>

      <section
        aria-labelledby="rules-heading"
        className="mx-auto grid w-full max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-3"
      >
        <h2 id="rules-heading" className="sr-only">
          Operating rules
        </h2>
        {operatingRules.map((rule) => (
          <Card key={rule.title}>
            <CardHeader>
              <CardTitle>{rule.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">{rule.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section
        aria-labelledby="lifecycle-heading"
        className="mx-auto mt-16 w-full max-w-6xl space-y-5 px-4 sm:px-6"
      >
        <div className="max-w-2xl space-y-2">
          <h2 id="lifecycle-heading" className="font-display text-3xl sm:text-4xl">
            How a meal moves
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Documented lifecycle. Not a live queue.
          </p>
        </div>
        <ol className="flex gap-2 overflow-x-auto pb-2">
          {fulfillmentPath.map((status, index) => (
            <li
              key={status}
              className="flex min-w-36 flex-1 items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 py-3"
            >
              <span className="text-sm font-medium">{status}</span>
              <span className="text-xs text-muted-foreground">
                {index + 1 < fulfillmentPath.length ? "→" : ""}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          Controlled exits: {fulfillmentExits.join(", ")}. A READY order with PENDING payment
          cannot become PICKED_UP.
        </p>
      </section>

      <section
        aria-labelledby="roles-heading"
        className="mx-auto mt-16 w-full max-w-6xl space-y-5 px-4 sm:px-6"
      >
        <h2 id="roles-heading" className="font-display text-3xl sm:text-4xl">
          Four desks, one canteen
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {roles.map((role, index) => (
            <Link
              key={role.href}
              href={role.href}
              className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs tracking-[0.16em] text-primary uppercase">
                0{index + 1}
              </p>
              <h3 className="mt-2 font-display text-3xl">{role.label}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{role.summary}</p>
            </Link>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="release-heading"
        className="mx-auto mt-16 mb-8 grid w-full max-w-6xl gap-4 px-4 sm:px-6 lg:grid-cols-2"
      >
        <h2 id="release-heading" className="sr-only">
          This release
        </h2>
        <Card>
          <CardHeader>
            <CardTitle>Available now</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm leading-6">
              {releaseNotes.available.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Not in this release</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
              {releaseNotes.unavailable.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
