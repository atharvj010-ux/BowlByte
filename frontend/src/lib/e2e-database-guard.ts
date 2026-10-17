/** Refuse Playwright cleanup against the authoritative BowlByte database. */

const LIVE_DATABASES = new Set(["bowlbyte", "postgres"]);

export function isolatedDatabaseName(raw: string | undefined): string {
  const name = (raw ?? "").trim();
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(name) || LIVE_DATABASES.has(name)) {
    throw new Error(
      "Refusing Playwright cleanup. Set E2E_DATABASE to a disposable database other than bowlbyte.",
    );
  }
  return name;
}

export function databaseNameFromUrl(url: string): string {
  const name = url.split("/").pop()?.split("?")[0]?.trim() ?? "";
  return isolatedDatabaseName(name);
}
