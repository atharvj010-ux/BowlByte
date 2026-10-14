import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { LaterPhase } from "@/components/later-phase";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Orders" };

export default function StudentOrdersPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {(user) => (
        <AccountHome user={user} note="Orders are not available yet." extra={<LaterPhase title="No orders" />} />
      )}
    </ProtectedArea>
  );
}
