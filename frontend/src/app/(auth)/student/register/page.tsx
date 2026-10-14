import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Student registration" };

export default function StudentRegisterPage() {
  return <RegisterForm />;
}
