import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SEED_VERSION } from "../../../packages/demo/src/version.ts";

const drizzleDir = fileURLToPath(new URL("../../../packages/core/drizzle/", import.meta.url));

/**
 * `<seed version>-<8 hex of the migrations>`: the IndexedDB database name suffix. A visitor whose
 * stored version differs gets a fresh, re-seeded database on their next visit.
 */
export function demoDataVersion(): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(`${drizzleDir}meta/_journal.json`));
  for (const file of readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    hash.update(file);
    hash.update(readFileSync(`${drizzleDir}${file}`));
  }
  return `${SEED_VERSION}-${hash.digest("hex").slice(0, 8)}`;
}
