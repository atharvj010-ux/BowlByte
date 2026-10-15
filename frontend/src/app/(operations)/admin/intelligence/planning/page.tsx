import type { Metadata } from "next";

import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { PlanningDesk } from "@/components/admin/planning-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Preparation planning" };

export default function PlanningPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <IntelligenceNav />
          <PlanningDesk role="CANTEEN_MANAGER" />
        </main>
      )}
    </ProtectedArea>
  );
}
