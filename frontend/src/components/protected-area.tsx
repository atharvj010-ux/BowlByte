import { Suspense, type ReactNode } from "react";

import { AccessDenied } from "@/components/account-home";
import { type CurrentUser } from "@/lib/auth";
import { redirectToLogin, requireRole } from "@/lib/server-session";

export function ProtectedArea({
  role,
  loginHref,
  children,
}: {
  role: CurrentUser["role"];
  loginHref: string;
  children: (user: CurrentUser) => ReactNode;
}) {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-sm text-muted-foreground">Checking your session.</p>}>
      <Authorized role={role} loginHref={loginHref} render={children} />
    </Suspense>
  );
}

async function Authorized({
  role,
  loginHref,
  render,
}: {
  role: CurrentUser["role"];
  loginHref: string;
  render: (user: CurrentUser) => ReactNode;
}) {
  const access = await requireRole(role);
  if (access.kind === "anonymous") {
    redirectToLogin(loginHref, access.expired);
  }
  if (access.kind === "forbidden") {
    return <AccessDenied user={access.user} />;
  }
  return render(access.user);
}
