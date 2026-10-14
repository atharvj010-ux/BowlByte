import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { LaterPhase } from "@/components/later-phase";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Menu" };

export default function StudentMenuPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {(user) => (
        <AccountHome user={user} note="The published menu arrives in a later phase." extra={<LaterPhase title="No menu" />} />
      )}
    </ProtectedArea>
  );
}
