import type { Metadata } from "next";

import { CashierDesk } from "@/components/cashier/cashier-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Cashier" };

export default function CashierPage() {
  return (
    <ProtectedArea role="CASHIER" loginHref="/cashier/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <CashierDesk />
        </main>
      )}
    </ProtectedArea>
  );
}
