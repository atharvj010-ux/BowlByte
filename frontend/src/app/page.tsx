import type { Metadata } from "next";

import { LandingExperience } from "@/components/home/landing";

export const metadata: Metadata = {
  title: "BowlByte",
  description: "Order ahead at the college canteen. The kitchen queues the ticket. You pay cash when you collect.",
};

export default function HomePage() {
  return <LandingExperience />;
}
