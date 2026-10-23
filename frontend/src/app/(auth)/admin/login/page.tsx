import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { redirectIfSignedIn } from "@/lib/server-session";

export const metadata: Metadata = { title: "Manager sign-in" };

export default async function AdminLoginPage() {
  await redirectIfSignedIn();
  return <LoginForm initialRole="CANTEEN_MANAGER" />;
}
