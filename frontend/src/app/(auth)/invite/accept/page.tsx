import type { Metadata } from "next";

import { AcceptInviteForm } from "@/components/auth/token-confirm";

export const metadata: Metadata = { title: "Accept invitation" };

export default function AcceptInvitePage() {
  return <AcceptInviteForm />;
}
