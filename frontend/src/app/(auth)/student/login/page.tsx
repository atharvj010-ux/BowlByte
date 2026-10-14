import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Student sign-in" };

export default function StudentLoginPage() {
  return (
    <LoginForm
      title="Student sign-in"
      description="Use the email you confirmed. Unverified accounts cannot sign in."
    />
  );
}
