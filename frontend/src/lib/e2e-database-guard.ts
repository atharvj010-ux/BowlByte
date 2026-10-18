/** Refuse Playwright cleanup against any database except the disposable cluster. */

const DISPOSABLE_DATABASE = "bowlbyte_e2e";
const DISPOSABLE_PORT = "55432";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const BOOLEAN_FLAGS = new Set(["1", "true", "yes", "on"]);

export function isolatedDatabaseName(raw: string | undefined): string {
  const name = (raw ?? "").trim();
  if (BOOLEAN_FLAGS.has(name.toLowerCase()) || name !== DISPOSABLE_DATABASE) {
    throw new Error(
      "Refusing Playwright cleanup. E2E_DATABASE must be the disposable database bowlbyte_e2e.",
    );
  }
  return name;
}

export function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url.replace(/^postgresql\+psycopg/, "postgresql"));
  const host = parsed.hostname.toLowerCase();
  const name = parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (
    host.endsWith("supabase.com") ||
    host.endsWith("supabase.co") ||
    host.includes("pooler") ||
    !LOCAL_HOSTS.has(host) ||
    parsed.port !== DISPOSABLE_PORT
  ) {
    throw new Error("Refusing Playwright cleanup against an unexpected database server.");
  }
  return isolatedDatabaseName(name);
}
