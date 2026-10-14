import type { Metadata } from "next";
import Link from "next/link";

import { AccountHome } from "@/components/account-home";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Manager" };

const note =
  "Menu, stock, and reports are not available yet. Staff invitations are available now.";

export default function AdminPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {(user) => (
        <AccountHome
          user={user}
          note={note}
          extra={
            <Link href="/admin/staff" className="text-sm underline-offset-4 hover:underline">
              Manage staff
            </Link>
          }
        />
      )}
    </ProtectedArea>
  );
}
