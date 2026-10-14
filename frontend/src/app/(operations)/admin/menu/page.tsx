import type { Metadata } from "next";

import { EmptyState } from "@/components/states/empty-state";

export const metadata: Metadata = { title: "Menu management" };

export default function AdminMenuPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <EmptyState
        title="Menu editing is not available"
        description="Managers will publish items here in a later phase. No prices are stored yet."
      />
    </main>
  );
}
