import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Cashier sign-in" };

export default function CashierLoginPage() {
  return (
    <LoginForm
      title="Cashier sign-in"
      description="Cashier accounts are created from a manager invitation."
    />
  );
}
