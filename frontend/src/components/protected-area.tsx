import type { ReactNode } from "react";

import { AccessDenied } from "@/components/account-home";
import { type CurrentUser } from "@/lib/auth";
import { redirectToLogin, requireRole } from "@/lib/server-session";

export async function ProtectedArea({
  role,
  loginHref,
  children,
}: {
  role: CurrentUser["role"];
  loginHref: string;
  children: (user: CurrentUser) => ReactNode;
}) {
  const access = await requireRole(role);
  if (access.kind === "anonymous") {
    redirectToLogin(loginHref, access.expired);
  }
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }
  return children(access.user);
}
