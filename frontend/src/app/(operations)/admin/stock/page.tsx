import type { Metadata } from "next";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { StockDesk } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <PageHead
            kicker="Floor control"
            title="Stock"
            description="Tap In stock, Few left, or Out of stock for each dish. Orders never change this — only you do. Students see the same status on the menu immediately."
          />
          <StockDesk />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
