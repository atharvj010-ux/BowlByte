import type { Metadata } from "next";

import { EmptyState } from "@/components/states/empty-state";

export const metadata: Metadata = { title: "Kitchen queue" };

export default function StaffQueuePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <EmptyState
        title="The queue is empty"
        description="Kitchen actions are not connected. This is not a paused live queue."
      />
    </main>
  );
}
