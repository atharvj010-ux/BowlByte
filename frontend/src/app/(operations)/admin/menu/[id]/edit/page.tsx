import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage, PageHead } from "@/components/admin/admin-ui";
import { MenuManager } from "@/components/admin/catalog-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Edit item" };

export default function EditMenuItemPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <ProtectedArea role="CANTEEN_MANAGER" loginHref="/admin/login">
      {() => <EditMenuItem params={params} />}
    </ProtectedArea>
  );
}

async function EditMenuItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminPage narrow>
      <PageHead
        kicker="Catalog · edit dish"
        title="Edit item"
        description="Changes reach the student menu as soon as you save."
        actions={
          <Link href="/admin/menu" className="mgr-link">
            ← Back to menu
          </Link>
        }
      />
      <MenuManager mode="edit" itemId={id} />
    </AdminPage>
  );
}
