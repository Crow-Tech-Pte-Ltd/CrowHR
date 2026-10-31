import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md rule 6 / architecture "Tenancy": people and organisation queries
 * filter by organisation through `orgScope()` (`actor.org`, or
 * `orgScope(db, orgId)` in helpers), never a hand-written
 * `eq(table.orgId, someOrgId)`. Composite join conditions between two tenant
 * tables (`eq(a.orgId, b.orgId)`) are fine.
 */
const srcDir = fileURLToPath(new URL("..", import.meta.url));
const MODULES = ["employees", "organisation"];
const ORG_FILTER = /eq\(\s*\w+\.orgId\s*,\s*([\w.]+)\s*\)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("people tenancy", () => {
  it("filters by organisation only through orgScope", () => {
    const offenders: string[] = [];
    for (const file of MODULES.flatMap((m) => sourceFiles(join(srcDir, m)))) {
      for (const match of readFileSync(file, "utf8").matchAll(ORG_FILTER)) {
        if (match[1]?.endsWith(".orgId")) continue;
        offenders.push(`${relative(srcDir, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
