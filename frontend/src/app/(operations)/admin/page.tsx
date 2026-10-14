import type { Metadata } from "next";

import { RoleScaffold } from "@/components/role-scaffold";

export const metadata: Metadata = { title: "Manager" };

export default function AdminPage() {
  return <RoleScaffold href="/admin" />;
}
