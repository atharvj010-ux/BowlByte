import type { Metadata } from "next";

import { RoleScaffold } from "@/components/role-scaffold";

export const metadata: Metadata = { title: "Cashier" };

export default function CashierPage() {
  return <RoleScaffold href="/cashier" />;
}
