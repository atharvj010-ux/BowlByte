import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { IncomingOrders } from "@/components/orders/order-views";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Kitchen" };

export default function StaffPage() {
  return (
    <ProtectedArea role="KITCHEN_STAFF" loginHref="/staff/login">
      {(user) => (
        <AccountHome
          user={user}
          note="These are new placed orders for your canteen. Marking them ready is a later phase."
          extra={<IncomingOrders />}
        />
      )}
    </ProtectedArea>
  );
}
