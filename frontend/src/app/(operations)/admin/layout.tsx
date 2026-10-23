import { Suspense, type ReactNode } from "react";

import AdminLoading from "./loading";
import { ManagerShell } from "@/components/admin/manager-shell";
import { fetchServerUser } from "@/lib/server-session";

// The session read is dynamic. It must sit inside Suspense or every /admin navigation blocks.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <ManagerFrame>{children}</ManagerFrame>
    </Suspense>
  );
}

async function ManagerFrame({ children }: { children: ReactNode }) {
  const user = await fetchServerUser();
  if (user?.role !== "CANTEEN_MANAGER") {
    return children;
  }
  return <ManagerShell name={user.full_name}>{children}</ManagerShell>;
}
