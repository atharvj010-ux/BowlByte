import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Students" };

const note =
  "Ordering, menus, and pickup are not available yet. They arrive in a later phase.";

export default function StudentPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {(user) => <AccountHome user={user} note={note} />}
    </ProtectedArea>
  );
}
