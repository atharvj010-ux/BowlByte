import type { Metadata } from "next";

import { AdminPage } from "@/components/admin/admin-ui";
import { CashOverview } from "@/components/admin/cash-overview";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Cash" };

export default function AdminCashPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <CashOverview />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
