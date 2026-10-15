import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { KitchenDesk } from "@/components/kitchen/kitchen-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Kitchen" };

export default function StaffPage() {
  return (
    <ProtectedArea role="KITCHEN_STAFF" loginHref="/staff/login">
      {(user) => (
        <AccountHome
          user={user}
          note="Accept tickets, prepare them at the station, and mark the order ready after packing. The cashier records cash after the order is ready."
          extra={<KitchenDesk />}
        />
      )}
    </ProtectedArea>
  );
}
