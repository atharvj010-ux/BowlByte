import type { Metadata } from "next";

import { CashOverview } from "@/components/admin/cash-overview";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Cash" };

export default function AdminCashPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <CashOverview />
        </main>
      )}
    </ProtectedArea>
  );
}
