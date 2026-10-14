import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states/empty-state";
import { roleByHref, type RoleHref } from "@/lib/content";

export function RoleScaffold({ href }: { href: RoleHref }) {
  const role = roleByHref(href);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="max-w-2xl space-y-4">
        <Badge>Scaffold</Badge>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">{role.indexTitle}</h1>
        <p className="text-base leading-7 text-muted-foreground">{role.summary}</p>
        <p className="text-sm leading-6 text-foreground">
          Authentication is not implemented. This page does not sign anyone in.
        </p>
      </div>
      <EmptyState
        title="No operational data"
        description="Orders, payments, menus, and notifications are not connected in this release."
      />
      <section aria-labelledby="later-duties" className="space-y-3">
        <h2 id="later-duties" className="font-display text-2xl">
          Planned duties
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {role.responsibilities.map((item) => (
            <li key={item} className="rounded-2xl border border-border bg-card px-4 py-4 text-sm leading-6">
              {item}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          Back to the overview
        </Link>
      </p>
    </main>
  );
}
