import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { LaterPhase } from "@/components/later-phase";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Queue" };

export default function StaffQueuePage() {
  return (
    <ProtectedArea role="KITCHEN_STAFF" loginHref="/staff/login">
      {(user) => (
        <AccountHome user={user} note="The kitchen queue arrives in a later phase." extra={<LaterPhase title="No tickets" />} />
      )}
    </ProtectedArea>
  );
}
