import type { Metadata } from "next";

import { KitchenOverview } from "@/components/kitchen/kitchen-overview";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Kitchen activity" };

export default function AdminKitchenPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-6">
          <h1 className="font-display text-4xl">Kitchen</h1>
          <KitchenOverview />
        </main>
      )}
    </ProtectedArea>
  );
}
