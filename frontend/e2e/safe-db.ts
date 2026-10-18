import { execFileSync } from "node:child_process";
import path from "node:path";

import { isolatedDatabaseName } from "../src/lib/e2e-database-guard";

export { isolatedDatabaseName };

const root = path.resolve(__dirname, "../..");
const psql =
  process.env.BOWLBYTE_PSQL ??
  path.join(
    process.env.LOCALAPPDATA ?? "",
    "BowlByte",
    "pgsql17",
    "pgsql",
    "bin",
    "psql.exe",
  );
const python =
  process.env.BOWLBYTE_PYTHON ?? path.join(root, "backend", ".venv", "Scripts", "python.exe");

function confirmedDatabase(): string {
  const database = isolatedDatabaseName(process.env.E2E_DATABASE);
  const actual = execFileSync(
    psql,
    [
      "-h",
      "127.0.0.1",
      "-p",
      "55432",
      "-U",
      "bowlbyte_e2e",
      "-d",
      database,
      "-tAc",
      "SELECT current_database() || '|' || host(inet_server_addr()) || '|' || inet_server_port()::text",
    ],
    { cwd: root, encoding: "utf8", env: process.env },
  ).trim();
  if (actual !== `${database}|127.0.0.1|55432`) {
    throw new Error("Refusing Playwright SQL: the connected database is not the disposable database.");
  }
  return database;
}

function runPsql(database: string, args: string[]): string {
  return execFileSync(
    psql,
    ["-h", "127.0.0.1", "-p", "55432", "-U", "bowlbyte_e2e", "-d", database, ...args],
    { cwd: root, encoding: "utf8", env: process.env },
  );
}

export function psqlCommand(sql: string): string {
  return runPsql(confirmedDatabase(), ["-v", "ON_ERROR_STOP=1", "-c", sql]);
}

export function psqlQuery(sql: string): string {
  return runPsql(confirmedDatabase(), ["-tAc", sql]).trim();
}

export function bootstrapIsolatedManager(
  email: string,
  managerPassword: string,
  fullName = "Pilot Manager",
): void {
  const database = confirmedDatabase();
  const url = `postgresql+psycopg://bowlbyte_e2e:${process.env.PGPASSWORD}@127.0.0.1:55432/${database}`;
  execFileSync(python, ["-m", "app.cli.bootstrap_manager"], {
    cwd: path.join(root, "backend"),
    input: `${managerPassword}\n`,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: url,
      SUPABASE_URL: "",
      SUPABASE_DB_URL: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_CREDENTIALS_ROTATED: "",
      BOWLBYTE_BOOTSTRAP_EMAIL: email,
      BOWLBYTE_BOOTSTRAP_NAME: fullName,
      E2E_DATABASE: database,
      REDIS_URL: "redis://127.0.0.1:6379/15",
    },
  });
}
