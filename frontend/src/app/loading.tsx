import { LoadingState } from "@/components/states/loading-state";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <LoadingState label="Loading BowlByte" />
    </div>
  );
}
