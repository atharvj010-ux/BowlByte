import type { Metadata } from "next";

import { ManagerOrders } from "@/components/admin/catalog-desk";
import { UnclaimedDesk } from "@/components/admin/unclaimed-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
          <h1 className="font-display text-4xl">Orders</h1>
          <UnclaimedDesk />
          <ManagerOrders />
        </main>
      )}
    </ProtectedArea>
  );
}
