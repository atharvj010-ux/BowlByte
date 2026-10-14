import type { Metadata } from "next";

import { ServiceStatus } from "@/components/service-status";

export const metadata: Metadata = {
  title: "Service status",
  description: "Live liveness and readiness reported by the BowlByte API.",
};

export default function StatusPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <ServiceStatus />
    </main>
  );
}
