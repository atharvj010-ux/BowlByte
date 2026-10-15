import type { Metadata } from "next";
import Link from "next/link";

import { CashHistory } from "@/components/cashier/cash-history";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Cash history" };

export default function CashierHistoryPage() {
  return (
    <ProtectedArea role="CASHIER" loginHref="/cashier/login">
      {() => (
        <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-10 sm:px-6">
          <Link href="/cashier" className="text-sm underline-offset-4 hover:underline">
            Back to the cashier desk
          </Link>
          <CashHistory />
        </main>
      )}
    </ProtectedArea>
  );
}
