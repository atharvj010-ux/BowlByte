"use client";

import { ErrorState } from "@/components/states/error-state";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <ErrorState
        title="This page failed to load"
        message="The screen could not be rendered. No order or payment was changed."
        onRetry={reset}
      />
    </div>
  );
}
