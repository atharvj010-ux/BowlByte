import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-ui";
import { IntelligenceNav } from "@/components/admin/intelligence-nav";
import { WasteDesk } from "@/components/admin/waste-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Waste" };

export default function WastePage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <IntelligenceNav />
          <WasteDesk />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
