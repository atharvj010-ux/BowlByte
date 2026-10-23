import type { Metadata } from "next";

import { VerifyEmailForm } from "@/components/auth/token-confirm";

export const metadata: Metadata = { title: "Confirm email" };

export default function VerifyEmailAliasPage() {
  return <VerifyEmailForm />;
}
