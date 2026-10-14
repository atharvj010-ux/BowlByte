import type { Metadata } from "next";

import { EmptyState } from "@/components/states/empty-state";

export const metadata: Metadata = { title: "Menu" };

export default function StudentMenuPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <EmptyState
        title="No menu is published"
        description="Menu items are not stored yet. Prices, when they exist, will be integer paise."
      />
    </main>
  );
}
