import type { Metadata } from "next";

import { AccountHome } from "@/components/account-home";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Cashier" };

const note = "Cash recording and pickup are not available yet. They arrive in a later phase.";

export default function CashierPage() {
  return (
    <ProtectedArea role="CASHIER" loginHref="/cashier/login">
      {(user) => <AccountHome user={user} note={note} />}
    </ProtectedArea>
  );
}
