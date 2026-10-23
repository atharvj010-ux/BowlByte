import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { redirectIfSignedIn } from "@/lib/server-session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  await redirectIfSignedIn();
  return <LoginForm initialRole="STUDENT" />;
}
