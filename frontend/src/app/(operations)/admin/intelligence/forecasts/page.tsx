import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-ui";
import { ForecastDesk } from "@/components/admin/forecast-desk";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Forecasts" };

export default function ForecastsPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <IntelligenceNav />
          <ForecastDesk />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
