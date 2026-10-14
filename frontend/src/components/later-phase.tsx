import { EmptyState } from "@/components/states/empty-state";

export function LaterPhase({ title }: { title: string }) {
  return (
    <EmptyState
      title={title}
      description="This operation is not part of the current release."
    />
  );
}
