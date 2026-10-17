import { execFileSync } from "node:child_process";
import path from "node:path";

import { isolatedDatabaseName } from "../src/lib/e2e-database-guard";

export { isolatedDatabaseName };

const root = path.resolve(__dirname, "../..");

function confirmedDatabase(): string {
  const database = isolatedDatabaseName(process.env.E2E_DATABASE);
  const actual = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "bowlbyte",
      "-d",
      database,
      "-tAc",
      "SELECT current_database()",
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (actual !== database || actual === "bowlbyte") {
    throw new Error("Refusing Playwright SQL: the connected database is not the disposable database.");
  }
  return database;
}

function psql(database: string, args: string[]): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "bowlbyte", "-d", database, ...args],
    { cwd: root, encoding: "utf8" },
  );
}

export function psqlCommand(sql: string): string {
  return psql(confirmedDatabase(), ["-v", "ON_ERROR_STOP=1", "-c", sql]);
}

export function psqlQuery(sql: string): string {
  return psql(confirmedDatabase(), ["-tAc", sql]).trim();
}

export function bootstrapIsolatedManager(
  email: string,
  managerPassword: string,
  fullName = "Pilot Manager",
): void {
  const database = confirmedDatabase();
  const url = `postgresql+psycopg://bowlbyte:bowlbyte@postgres:5432/${database}`;
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "-e",
      `DATABASE_URL=${url}`,
      "-e",
      `BOWLBYTE_BOOTSTRAP_EMAIL=${email}`,
      "-e",
      `BOWLBYTE_BOOTSTRAP_NAME=${fullName}`,
      "backend",
      "python",
      "-m",
      "app.cli.bootstrap_manager",
    ],
    { cwd: root, input: `${managerPassword}\n`, encoding: "utf8" },
  );
}
