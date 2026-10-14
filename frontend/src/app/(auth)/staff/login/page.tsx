import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Kitchen sign-in" };

export default function StaffLoginPage() {
  return (
    <LoginForm
      title="Kitchen sign-in"
      description="Kitchen accounts are created from a manager invitation."
    />
  );
}
