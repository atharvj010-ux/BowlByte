import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Manager sign-in" };

export default function AdminLoginPage() {
  return (
    <LoginForm
      title="Manager sign-in"
      description="The first manager is created with the bootstrap command. There is no public manager registration."
    />
  );
}
