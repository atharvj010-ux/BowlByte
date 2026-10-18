/** Teardown never archives or truncates a live database. */

const BOOLEAN_FLAGS = new Set(["1", "true", "yes", "on"]);

export default function globalTeardown() {
  const name = (process.env.E2E_DATABASE ?? "").trim();
  if (!name) {
    return;
  }
  if (BOOLEAN_FLAGS.has(name.toLowerCase()) || name !== "bowlbyte_e2e") {
    throw new Error("Refusing Playwright teardown against an unexpected database.");
  }
}
