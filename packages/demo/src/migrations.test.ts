import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./bundled-migrations.ts";
import { readBundledMigrations } from "./migrations.ts";

const folder = fileURLToPath(new URL("../../core/drizzle", import.meta.url));

describe("bundled migrations", () => {
  it("bundle every SQL file of packages/core/drizzle byte for byte", () => {
    const files = readdirSync(folder).filter((f) => f.endsWith(".sql"));
    expect(Object.keys(CORE_MIGRATIONS.sql).sort()).toEqual(files.map((f) => f.replace(/\.sql$/, "")).sort());
    for (const f of files) {
      expect(CORE_MIGRATIONS.sql[f.replace(/\.sql$/, "")]).toBe(readFileSync(`${folder}/${f}`, "utf8"));
    }
  });

  it("read exactly like drizzle's filesystem migrator (same statements, timestamps and hashes)", async () => {
    const fromDisk = readMigrationFiles({ migrationsFolder: folder });
    const bundled = await readBundledMigrations(CORE_MIGRATIONS);
    expect(bundled).toEqual(fromDisk);
    expect(bundled[0]?.hash).toBe(
      createHash("sha256")
        .update(readFileSync(`${folder}/0000_init.sql`, "utf8"))
        .digest("hex"),
    );
  });

  it("refuse a journal entry whose SQL was not bundled", async () => {
    await expect(
      readBundledMigrations({
        journal: { entries: [{ idx: 0, when: 1, tag: "9999_missing", breakpoints: true }] },
        sql: {},
      }),
    ).rejects.toThrow(/9999_missing/);
  });
});
