import { describe, expect, it } from "vitest";

import { databaseNameFromUrl, isolatedDatabaseName } from "@/lib/e2e-database-guard";

describe("e2e database guard", () => {
  it("rejects live names and a boolean override", () => {
    expect(() => isolatedDatabaseName("bowlbyte")).toThrow(/disposable/i);
    expect(() => isolatedDatabaseName("postgres")).toThrow(/disposable/i);
    expect(() => isolatedDatabaseName("true")).toThrow(/disposable/i);
    expect(() => isolatedDatabaseName("")).toThrow(/disposable/i);
    expect(isolatedDatabaseName("bowlbyte_e2e")).toBe("bowlbyte_e2e");
  });

  it("accepts only the localhost disposable server", () => {
    expect(
      databaseNameFromUrl("postgresql+psycopg://bowlbyte_e2e:secret@127.0.0.1:55432/bowlbyte_e2e"),
    ).toBe("bowlbyte_e2e");
    expect(() =>
      databaseNameFromUrl("postgresql+psycopg://bowlbyte:bowlbyte@postgres:5432/bowlbyte_e2e"),
    ).toThrow(/unexpected/i);
    expect(() =>
      databaseNameFromUrl("postgresql://user:secret@127.0.0.1:5432/bowlbyte"),
    ).toThrow(/unexpected|disposable/i);
  });
});
