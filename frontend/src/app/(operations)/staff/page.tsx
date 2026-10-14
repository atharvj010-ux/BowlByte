import type { Metadata } from "next";

import { RoleScaffold } from "@/components/role-scaffold";

export const metadata: Metadata = { title: "Kitchen" };

export default function StaffPage() {
  return <RoleScaffold href="/staff" />;
}
