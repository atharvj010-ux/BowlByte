import type { Metadata } from "next";

import { ForecastDesk } from "@/components/admin/forecast-desk";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Forecasts" };

export default function ForecastsPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <IntelligenceNav />
          <ForecastDesk />
        </main>
      )}
    </ProtectedArea>
  );
}
