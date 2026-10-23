import type { Metadata } from "next";

import { KitchenDesk } from "@/components/kitchen/kitchen-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Kitchen" };

export default function StaffPage() {
  return (
    <ProtectedArea role="KITCHEN_STAFF" loginHref="/staff/login">
      {(user) => (
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
          <KitchenDesk user={user} />
        </main>
      )}
    </ProtectedArea>
  );
}
