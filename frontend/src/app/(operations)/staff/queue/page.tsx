import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { KitchenDesk } from "@/components/kitchen/kitchen-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Queue" };

export default function StaffQueuePage() {
  return (
    <ProtectedArea role="KITCHEN_STAFF" loginHref="/staff/login">
      {(user) => (
        <AccountHome
          user={user}
          note="The same live queue as the kitchen board."
          extra={<KitchenDesk />}
        />
      )}
    </ProtectedArea>
  );
}
