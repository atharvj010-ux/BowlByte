import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { ProtectedArea } from "@/components/protected-area";
import { StaffDesk } from "@/components/staff-desk";

export const metadata: Metadata = { title: "Staff" };

export default function AdminStaffPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {(user) => (
        <AccountHome
          user={user}
          note="Invite kitchen staff or a cashier for this canteen. Manager access is not granted here."
          extra={<StaffDesk />}
        />
      )}
    </ProtectedArea>
  );
}
