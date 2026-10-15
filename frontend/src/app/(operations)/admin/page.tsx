import type { Metadata } from "next";
import Link from "next/link";

import { AccountHome } from "@/components/account-home";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Manager" };

const links = [
  ["/admin/menu", "Menu"],
  ["/admin/stations", "Stations"],
  ["/admin/kitchen", "Kitchen"],
  ["/admin/stock", "Stock"],
  ["/admin/orders", "Orders"],
  ["/admin/cash", "Cash"],
  ["/admin/staff", "Staff"],
  ["/admin/intelligence", "Intelligence"],
  ["/admin/production", "Production"],
  ["/admin/waste", "Waste"],
] as const;

export default function AdminPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {(user) => (
        <AccountHome
          user={user}
          note="Manage the menu, stations, cash, production, waste, and preparation plans."
          extra={
            <nav className="flex flex-wrap gap-3 text-sm" aria-label="Manager">
              {links.map(([href, label]) => (
                <Link key={href} href={href} className="underline-offset-4 hover:underline">
                  {label}
                </Link>
              ))}
            </nav>
          }
        />
      )}
    </ProtectedArea>
  );
}
