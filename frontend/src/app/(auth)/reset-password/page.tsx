import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/recovery-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
