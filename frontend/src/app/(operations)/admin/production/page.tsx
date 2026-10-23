import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-ui";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { ProductionDesk } from "@/components/admin/production-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Production" };

export default function ProductionPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <IntelligenceNav />
          <ProductionDesk />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
