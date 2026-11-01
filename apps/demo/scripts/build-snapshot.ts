/** Node-only build step: the real migrations and seed, stored as a gzip PGlite data directory. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildDemoSnapshot } from "../../../packages/demo/scripts/snapshot.ts";
import type { MigrationBundle } from "../../../packages/demo/src/migrations.ts";
import { demoDataVersion } from "./data-version.ts";

const migrations = new URL("../../../packages/core/drizzle/", import.meta.url);
const journal = JSON.parse(
  await readFile(new URL("meta/_journal.json", migrations), "utf8"),
) as MigrationBundle["journal"];
const sql: Record<string, string> = {};
for (const entry of journal.entries) sql[entry.tag] = await readFile(new URL(`${entry.tag}.sql`, migrations), "utf8");
const version = demoDataVersion();
const snapshot = await buildDemoSnapshot(version, { journal, sql });
const directory = new URL("../dist/assets/", import.meta.url);
await mkdir(directory, { recursive: true });
const target = new URL(`demo-${version}.tar.gz`, directory);
await writeFile(target, new Uint8Array(await snapshot.arrayBuffer()));
console.warn(`Demo snapshot: ${fileURLToPath(target)} (${Math.round(snapshot.size / 1024)} kB gzip)`);
