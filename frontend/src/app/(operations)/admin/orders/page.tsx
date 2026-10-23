import type { Metadata } from "next";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { ManagerOrders } from "@/components/admin/catalog-desk";
import { UnclaimedDesk } from "@/components/admin/unclaimed-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <PageHead
            kicker="Floor · every ticket"
            title="Orders"
            description="Filter by status or service date, search a ticket, and settle unclaimed pickups. Cash is only counted when a cashier confirms it."
          />
          <UnclaimedDesk />
          <ManagerOrders />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
