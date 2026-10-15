import type { Metadata } from "next";

import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { WasteDesk } from "@/components/admin/waste-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Waste" };

export default function WastePage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <IntelligenceNav />
          <WasteDesk />
        </main>
      )}
    </ProtectedArea>
  );
}
