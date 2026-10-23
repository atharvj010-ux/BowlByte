import type { Metadata } from "next";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { ProtectedArea } from "@/components/protected-area";
import { StaffDesk } from "@/components/staff-desk";

export const metadata: Metadata = { title: "Staff" };

export default function AdminStaffPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {(user) => (
        <AdminPage>
          <PageHead
            kicker="People · access"
            title="Staff & access"
            description={
              <span data-testid="account-name">
                Signed in as {user.full_name}. Invite kitchen staff or a cashier for this canteen. Manager access is
                not granted here.
              </span>
            }
          />
          <StaffDesk />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
