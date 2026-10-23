import type { Metadata } from "next";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { StationDesk } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Stations" };

export default function StationsPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <PageHead
            kicker="Kitchen lines"
            title="Stations"
            description="Capacity changes apply to new task starts and the readiness estimate. Tasks already cooking keep their station until staff finish them."
          />
          <StationDesk />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
