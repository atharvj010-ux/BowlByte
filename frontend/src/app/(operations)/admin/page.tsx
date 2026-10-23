import type { Metadata } from "next";

import { ManagerDesk } from "@/components/admin/manager-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Manager" };

export default function AdminPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {(user) => <ManagerDesk user={user} />}
    </ProtectedArea>
  );
}
