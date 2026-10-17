/** Teardown never archives or truncates the live bowlbyte database. */

export default function globalTeardown() {
  if (!process.env.E2E_DATABASE) {
    return;
  }
  if (process.env.E2E_DATABASE.trim() === "bowlbyte") {
    throw new Error("Refusing Playwright teardown against the authoritative database.");
  }
}
