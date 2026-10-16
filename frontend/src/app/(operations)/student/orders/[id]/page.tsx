import type { Metadata } from "next";

import { OrderDetail } from "@/components/orders/order-views";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Order" };

export default async function StudentOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <OrderDetail orderId={id} />
        </main>
      )}
    </ProtectedArea>
  );
}
