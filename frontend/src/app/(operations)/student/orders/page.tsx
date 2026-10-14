import type { Metadata } from "next";

import { OrderHistory } from "@/components/orders/order-views";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Orders" };

export default function StudentOrdersPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {() => (
        <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
          <h1 className="font-display text-4xl">Your orders</h1>
          <OrderHistory />
        </main>
      )}
    </ProtectedArea>
  );
}
