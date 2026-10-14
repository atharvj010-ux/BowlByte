import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { LaterPhase } from "@/components/later-phase";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Menu management" };

export default function AdminMenuPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {(user) => (
        <AccountHome user={user} note="Menu editing arrives in a later phase." extra={<LaterPhase title="No menu items" />} />
      )}
    </ProtectedArea>
  );
}
