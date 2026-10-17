import { describe, expect, it } from "vitest";

import { databaseNameFromUrl, isolatedDatabaseName } from "@/lib/e2e-database-guard";

describe("e2e database guard", () => {
  it("rejects the live database and accepts a disposable name", () => {
    expect(() => isolatedDatabaseName("bowlbyte")).toThrow(/authoritative|disposable|bowlbyte/i);
    expect(() => isolatedDatabaseName("postgres")).toThrow(/disposable/i);
    expect(() => isolatedDatabaseName("")).toThrow(/disposable/i);
    expect(isolatedDatabaseName("bowlbyte_e2e")).toBe("bowlbyte_e2e");
  });

  it("reads the database name from a URL and still rejects the live database", () => {
    expect(databaseNameFromUrl("postgresql+psycopg://bowlbyte:bowlbyte@postgres:5432/bowlbyte_e2e")).toBe(
      "bowlbyte_e2e",
    );
    expect(() => databaseNameFromUrl("postgresql+psycopg://bowlbyte:bowlbyte@postgres:5432/bowlbyte")).toThrow(
      /bowlbyte/i,
    );
  });
});
