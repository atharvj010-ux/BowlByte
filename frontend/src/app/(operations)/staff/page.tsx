import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Kitchen" };

const note = "The kitchen queue is not available yet. It arrives in a later phase.";

export default function StaffPage() {
  return (
    <ProtectedArea role="KITCHEN_STAFF" loginHref="/staff/login">
      {(user) => <AccountHome user={user} note={note} />}
    </ProtectedArea>
  );
}
