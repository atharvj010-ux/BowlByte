import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-ui";
import { IntelligenceDashboard } from "@/components/admin/intelligence-dashboard";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Food intelligence" };

export default function IntelligencePage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <IntelligenceNav />
          <IntelligenceDashboard />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
