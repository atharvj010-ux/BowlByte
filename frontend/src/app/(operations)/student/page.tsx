import type { Metadata } from "next";

import { RoleScaffold } from "@/components/role-scaffold";

export const metadata: Metadata = { title: "Students" };

export default function StudentPage() {
  return <RoleScaffold href="/student" />;
}
