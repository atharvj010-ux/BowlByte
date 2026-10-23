import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { redirectIfSignedIn } from "@/lib/server-session";

export const metadata: Metadata = { title: "Kitchen sign-in" };

export default async function StaffLoginPage() {
  await redirectIfSignedIn();
  return <LoginForm initialRole="KITCHEN_STAFF" />;
}
