import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { MenuManager } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "New item" };

export default function NewMenuItemPage() {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => (
        <AdminPage narrow>
          <PageHead
            kicker="Catalog · new dish"
            title="New item"
            description="Fill in the basics, choose where it is cooked, and set its shelf status. You can add a photo and pairings after saving."
            actions={
              <Link href="/admin/menu" className="mgr-link">
                ← Back to menu
              </Link>
            }
          />
          <MenuManager mode="create" />
        </AdminPage>
      )}
    </ProtectedArea>
  );
}
