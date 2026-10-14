import Link from "next/link";
import type { ReactNode } from "react";

import { roleLabel, type CurrentUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";

export function AccountHome({
  user,
  note,
  extra,
}: {
  user: CurrentUser;
  note: string;
  extra?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="max-w-2xl space-y-4">
        <Badge>{roleLabel(user.role)}</Badge>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">Hello, {user.full_name}</h1>
        <p className="text-base leading-7 text-muted-foreground" data-testid="account-name">
          Signed in as {user.full_name}. Role: {roleLabel(user.role)}.
        </p>
        <p className="text-sm leading-6">{note}</p>
      </div>
      {extra}
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          Back to the overview
        </Link>
      </p>
    </main>
  );
}

export function AccessDenied({ user }: { user: CurrentUser }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl">This area is closed</h1>
      <p data-testid="access-denied">
        {user.full_name}, your {roleLabel(user.role).toLowerCase()} account cannot open this page.
      </p>
    </main>
  );
}
