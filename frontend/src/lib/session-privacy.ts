const PRIVATE_ROOTS = ["/student", "/staff", "/cashier", "/admin"];

export function isPrivatePath(pathname: string): boolean {
  if (
    pathname.includes("/login") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/invite")
  ) {
    return false;
  }
  return PRIVATE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function loginHrefFor(pathname: string): string {
  if (pathname.startsWith("/cashier")) {
    return "/cashier/login?reason=expired";
  }
  if (pathname.startsWith("/admin")) {
    return "/admin/login?reason=expired";
  }
  if (pathname.startsWith("/staff")) {
    return "/staff/login?reason=expired";
  }
  return "/student/login?reason=expired";
}
