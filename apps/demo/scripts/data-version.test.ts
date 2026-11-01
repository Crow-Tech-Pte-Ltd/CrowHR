import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { demoDataVersion } from "./data-version.ts";

it("invalidates for demo seed, shared people seed and migration edits without a manual version bump", () => {
  const root = mkdtempSync(join(tmpdir(), "crowhr-data-version-"));
  const write = (path: string, text: string) => {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text);
  };
  try {
    write("packages/core/drizzle/meta/_journal.json", "{}");
    write("packages/core/drizzle/0000.sql", "create table example(id int);");
    write("packages/demo/src/seed/index.ts", "seed v1");
    write("packages/core/src/testing/seed-people.ts", "people v1");
    write("packages/demo/package.json", "{}");
    const url = pathToFileURL(`${root}/`);
    const versions = [demoDataVersion(url)];
    for (const path of [
      "packages/demo/src/seed/index.ts",
      "packages/core/src/testing/seed-people.ts",
      "packages/core/drizzle/0000.sql",
    ]) {
      write(path, "changed");
      versions.push(demoDataVersion(url));
    }
    expect(new Set(versions).size).toBe(4);
    write("packages/demo/src/seed.test.ts", "test-only change");
    expect(demoDataVersion(url)).toBe(versions.at(-1));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
