import type { Metadata } from "next";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { KitchenOverview } from "@/components/kitchen/kitchen-overview";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Kitchen activity" };

export default function AdminKitchenPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <PageHead
            kicker="Live · refreshes every 15 seconds"
            title="Kitchen"
            description="What the kitchen is working on right now, how long it takes, and how loaded each station is."
          />
          <KitchenOverview />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
