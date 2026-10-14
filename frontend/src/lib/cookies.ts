export function secureCookiePrefix(): boolean {
  return (
    process.env.COOKIE_SECURE === "true" || process.env.NEXT_PUBLIC_COOKIE_SECURE === "true"
  );
}

export function sessionCookieName(): string {
  return secureCookiePrefix() ? "__Host-bowlbyte_session" : "bowlbyte_session";
}

export function csrfCookieName(): string {
  return secureCookiePrefix() ? "__Host-bowlbyte_csrf" : "bowlbyte_csrf";
}

export function readCookie(name: string): string {
  if (typeof document === "undefined") {
    return "";
  }
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}
