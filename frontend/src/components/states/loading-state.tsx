import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
