import type { Metadata } from "next";

import { HistoryDesk } from "@/components/admin/history-desk";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Demand history" };

export default function HistoryPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <IntelligenceNav />
          <HistoryDesk />
        </main>
      )}
    </ProtectedArea>
  );
}
