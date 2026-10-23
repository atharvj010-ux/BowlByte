import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { redirectIfSignedIn } from "@/lib/server-session";

export const metadata: Metadata = { title: "Cashier sign-in" };

export default async function CashierLoginPage() {
  await redirectIfSignedIn();
  return <LoginForm initialRole="CASHIER" />;
}
