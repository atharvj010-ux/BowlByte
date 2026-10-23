import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-ui";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { PlanningDesk } from "@/components/admin/planning-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Preparation planning" };

export default function PlanningPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <IntelligenceNav />
          <PlanningDesk role="CANTEEN_MANAGER" />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
