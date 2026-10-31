/**
 * After `vite build`: reports the demo's size (raw, gzip, brotli) by kind and checks the output
 * once more for server-only code (the build plugin checks the module graph; this checks bytes).
 *
 *   node scripts/check-bundle.ts [distDir]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const dist = process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));

/** Strings that only exist inside server-only packages. */
const MARKERS: [string, string][] = [
  ["@node-rs/argon2", "argon2 binding"],
  ["argon2.node", "argon2 binding"],
  ["Client has already been connected. You cannot reuse a client.", "node-postgres"],
  ["nodemailer", "nodemailer"],
  ["@hono/node-server", "@hono/node-server"],
  ["CROWHR_SECRET_KEY must", "apps/server config"],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// PGlite's binaries ship as .gz (already compressed): classify them by their real type.
const kindOf = (file: string, f = file.replace(/\.gz$/, "")) =>
  f.endsWith(".wasm")
    ? "wasm"
    : f.endsWith(".data")
      ? "pglite-data"
      : f.endsWith(".js")
        ? /assets\/(worker|runtime)-/.test(f)
          ? "js (API worker)"
          : "js (page)"
        : /\.(woff2?)$/.test(f)
          ? "fonts"
          : f.endsWith(".css")
            ? "css"
            : "other";

const rows = walk(dist).map((file) => {
  const data = readFileSync(file);
  return {
    file: relative(dist, file),
    kind: kindOf(file),
    raw: data.length,
    gzip: gzipSync(data, { level: 9 }).length,
    brotli: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    text: /\.(js|html|css)$/.test(file) ? data.toString("utf8") : "",
  };
});

const problems: string[] = [];
for (const r of rows) for (const [m, what] of MARKERS) if (r.text.includes(m)) problems.push(`${r.file}: ${what}`);

const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
const byKind = new Map<string, { raw: number; gzip: number; brotli: number }>();
for (const r of rows) {
  const k = byKind.get(r.kind) ?? { raw: 0, gzip: 0, brotli: 0 };
  k.raw += r.raw;
  k.gzip += r.gzip;
  k.brotli += r.brotli;
  byKind.set(r.kind, k);
}
const total = [...byKind.values()].reduce(
  (a, b) => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip, brotli: a.brotli + b.brotli }),
  {
    raw: 0,
    gzip: 0,
    brotli: 0,
  },
);
const lines = [
  "kind                raw        gzip       brotli",
  ...[...byKind.entries()]
    .sort((a, b) => b[1].raw - a[1].raw)
    .map(
      ([k, v]) => `${k.padEnd(18)}  ${kb(v.raw).padStart(9)}  ${kb(v.gzip).padStart(9)}  ${kb(v.brotli).padStart(9)}`,
    ),
  `${"total".padEnd(18)}  ${kb(total.raw).padStart(9)}  ${kb(total.gzip).padStart(9)}  ${kb(total.brotli).padStart(9)}`,
];
console.warn(lines.join("\n"));
if (problems.length) {
  console.error(`Server-only code found in the demo build:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
