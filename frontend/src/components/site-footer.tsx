import { Separator } from "@/components/ui/separator";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <Separator />
        <p>BowlByte. Cash at the counter. No online payments.</p>
        <p>Forecast figures are from a seeded series until a real canteen history exists.</p>
      </div>
    </footer>
  );
}
