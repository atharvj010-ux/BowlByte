import { Separator } from "@/components/ui/separator";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <Separator />
        <p>BowlByte phase P001. Counter pickup and cash only.</p>
        <p>Ordering, accounts, notifications, and forecasting are not available in this release.</p>
      </div>
    </footer>
  );
}
