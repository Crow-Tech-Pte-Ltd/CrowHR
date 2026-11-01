import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SEED_VERSION } from "../../../packages/demo/src/version.ts";

const project = new URL("../../../", import.meta.url);

/** Seed version + content hash: edits to the real seed or migrations always invalidate the snapshot. */
export function demoDataVersion(root = project): string {
  const hash = createHash("sha256");
  const file = (path: string) => {
    hash.update(path);
    hash.update(readFileSync(new URL(path, root)));
  };
  const drizzleDir = fileURLToPath(new URL("packages/core/drizzle/", root));
  file("packages/core/drizzle/meta/_journal.json");
  for (const name of readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    file(`packages/core/drizzle/${name}`);
  const src = fileURLToPath(new URL("packages/demo/src/", root));
  for (const name of readdirSync(src, { recursive: true })
    .filter((p): p is string => typeof p === "string" && p.endsWith(".ts") && !p.endsWith(".test.ts"))
    .sort())
    file(`packages/demo/src/${name}`);
  // The demo builds on core's shared fictional people seed as well as its own source.
  file("packages/core/src/testing/seed-people.ts");
  file("packages/demo/package.json");
  return `${SEED_VERSION}-${hash.digest("hex").slice(0, 12)}`;
}
