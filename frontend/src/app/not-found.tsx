import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-20 sm:px-6">
      <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">404</p>
      <h1 className="font-display text-4xl">That page is not on the menu.</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        The address does not match a BowlByte screen.
      </p>
      <Button asChild className="self-start">
        <Link href="/">Return home</Link>
      </Button>
    </main>
  );
}
