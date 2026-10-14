import type { Metadata } from "next";

import { StationDesk } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Stations" };

export default function StationsPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
          <h1 className="font-display text-4xl">Stations</h1>
          <p className="text-sm text-muted-foreground">
            Capacity changes apply to new task starts and the readiness estimate. Tasks already
            cooking keep their station until staff finish them.
          </p>
          <StationDesk />
        </main>
      )}
    </ProtectedArea>
  );
}
