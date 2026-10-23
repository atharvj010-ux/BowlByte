import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-ui";
import { HistoryDesk } from "@/components/admin/history-desk";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Demand history" };

export default function HistoryPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <IntelligenceNav />
          <HistoryDesk />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
