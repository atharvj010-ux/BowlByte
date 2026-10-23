import { Suspense } from "react";
import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Student registration" };

export default function StudentRegisterPage() {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-sm text-muted-foreground">Loading registration.</p>}>
      <RegisterForm />
    </Suspense>
  );
}
