import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { redirectIfSignedIn } from "@/lib/server-session";

export const metadata: Metadata = { title: "Student sign-in" };

export default async function StudentLoginPage() {
  await redirectIfSignedIn();
  return <LoginForm initialRole="STUDENT" />;
}
