import type { Metadata } from "next";

import { EmptyState } from "@/components/states/empty-state";

export const metadata: Metadata = { title: "Orders" };

export default function StudentOrdersPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <EmptyState
        title="No orders"
        description="Order placement is not available. Nothing on this page is a sample ticket."
      />
    </main>
  );
}
