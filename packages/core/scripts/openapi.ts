/**
 * `bun run openapi:generate` — write openapi/v1.snapshot.json from the route declarations.
 * `bun run openapi:check`    — fail when the snapshot is stale, or when the contract breaks
 *                              against the latest released snapshot in openapi/releases/.
 * Runs on Node 24 (native type stripping); see docs/api.md.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { V1_MODULES } from "../src/app.ts";
import { buildOpenApiDocument } from "../src/openapi/generate.ts";
import { diffOpenApi, formatChanges, type OpenApiLike } from "./openapi-diff.ts";

const dir = fileURLToPath(new URL("../openapi/", import.meta.url));
const snapshotPath = `${dir}v1.snapshot.json`;
const generated = `${JSON.stringify(buildOpenApiDocument(V1_MODULES), null, 2)}\n`;
const mode = process.argv[2];

if (mode === "generate") {
  writeFileSync(snapshotPath, generated);
  console.error(`Wrote ${snapshotPath}`);
} else if (mode === "check") {
  let failed = false;
  let current = "";
  try {
    current = readFileSync(snapshotPath, "utf8");
  } catch {
    // missing snapshot is reported below
  }
  if (current !== generated) {
    console.error("openapi/v1.snapshot.json is out of date. Run `bun run openapi:generate` and commit the result.");
    failed = true;
  }
  const releases = readdirSync(`${dir}releases`)
    .filter((f) => /^v1\.\d+\.json$/.test(f))
    .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]));
  const latest = releases.at(-1);
  if (latest) {
    const base = JSON.parse(readFileSync(`${dir}releases/${latest}`, "utf8")) as OpenApiLike;
    const changes = diffOpenApi(base, JSON.parse(generated) as OpenApiLike);
    if (changes.length) {
      console.error(
        `Breaking API changes against released ${latest} (v1 is additive only; see docs/api.md):\n${formatChanges(changes)}`,
      );
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.error(
    `OpenAPI snapshot up to date${latest ? `; no breaking changes against ${latest}` : " (no released snapshot yet)"}.`,
  );
} else {
  console.error("Usage: node scripts/openapi.ts generate|check");
  process.exit(2);
}
