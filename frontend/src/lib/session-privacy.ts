const PRIVATE_ROOTS = ["/student", "/staff", "/cashier", "/admin"];
export const CART_STORAGE_KEY = "bowlbyte.cart.v1";

/** Drop cart lines that belong to the signed-in browser session. */
export function clearPrivateBrowserState(): void {
  window.localStorage.removeItem(CART_STORAGE_KEY);
  window.dispatchEvent(new Event("bowlbyte-cart"));
}

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
