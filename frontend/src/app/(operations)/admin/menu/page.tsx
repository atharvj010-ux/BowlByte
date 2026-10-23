import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { MenuManager } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Menu" };

export default function AdminMenuPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage>
          <PageHead
            kicker="Catalog"
            title="Menu"
            description="Arrange categories, set the order students see, and open any dish to edit its price, photo, and pairings."
            actions={
              <Link href="/admin/menu/new" className="mgr-cta">
                <span aria-hidden="true">+</span> Add menu item
              </Link>
            }
          />
          <MenuManager mode="list" />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
