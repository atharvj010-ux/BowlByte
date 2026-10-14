import type { Metadata } from "next";

import { StockDesk } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
          <h1 className="font-display text-4xl">Stock</h1>
          <StockDesk />
        </main>
      )}
    </ProtectedArea>
  );
}
