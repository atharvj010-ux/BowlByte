import type { Metadata } from "next";

import { IntelligenceDashboard } from "@/components/admin/intelligence-dashboard";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Food intelligence" };

export default function IntelligencePage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <IntelligenceNav />
          <IntelligenceDashboard />
        </main>
      )}
    </ProtectedArea>
  );
}
