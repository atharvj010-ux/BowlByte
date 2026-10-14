import type { Metadata } from "next";

import { MenuManager } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Menu" };

export default function AdminMenuPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-10 sm:px-6">
          <h1 className="font-display text-4xl">Menu</h1>
          <MenuManager mode="list" />
        </main>
      )}
    </ProtectedArea>
  );
}
