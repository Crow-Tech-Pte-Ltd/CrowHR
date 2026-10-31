/**
 * Post-build checks on apps/docs/dist (no dependencies, runs with `node scripts/check-dist.ts`):
 *
 * 1. Every internal link (`href`/`src` under the site base, or relative) points at a file that
 *    exists, and every `#fragment` points at an element id on the target page.
 * 2. Every operation in the OpenAPI snapshot has a section in the generated API reference.
 * 3. Every page has a <title>, a meta description and a canonical URL, and exactly one <h1>.
 *
 * Exits 1 with a list of problems.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groupByTag, type OpenApiDocument } from "../src/lib/openapi.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const BASE = "/docs/";
const SITE = "https://hr.crow.sg";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

const idCache = new Map<string, Set<string>>();
function idsOf(file: string): Set<string> {
  let ids = idCache.get(file);
  if (!ids) {
    const html = readFileSync(file, "utf8");
    ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1] as string)));
    idCache.set(file, ids);
  }
  return ids;
}

/** Maps a site path (/docs/a/b/) to a file in dist, or null when nothing matches. */
function fileFor(pathname: string): string | null {
  const rel = decodeURIComponent(pathname.slice(BASE.length));
  const candidates =
    rel === "" || rel.endsWith("/")
      ? [join(DIST, rel, "index.html")]
      : [join(DIST, rel), join(DIST, rel, "index.html")];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

if (!existsSync(DIST)) {
  console.error("apps/docs/dist does not exist. Run `astro build` first.");
  process.exit(1);
}

const problems: string[] = [];
const files = walk(DIST);
const pages = files.filter((f) => f.endsWith(".html"));
let linkCount = 0;

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const pageRel = relative(DIST, page);
  const pagePath = `${BASE}${pageRel.replace(/index\.html$/, "")}`;

  // 3. Head and heading sanity (Pagefind's own UI fragments are not pages).
  if (!pageRel.startsWith("pagefind/")) {
    if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${pageRel}: missing <title>`);
    if (!/<meta name="description" content="[^"]+"/.test(html)) problems.push(`${pageRel}: missing meta description`);
    if (!/<link rel="canonical" href="https:\/\/hr\.crow\.sg\/docs\//.test(html))
      problems.push(`${pageRel}: missing canonical URL under ${SITE}${BASE}`);
    const h1 = html.match(/<h1[\s>]/g)?.length ?? 0;
    if (h1 !== 1) problems.push(`${pageRel}: expected exactly one <h1>, found ${h1}`);
  }

  // 1. Links and fragments.
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = decode(m[1] as string);
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue; // external, mailto:, data:
    linkCount++;
    const url = new URL(raw, `${SITE}${pagePath}`);
    if (!url.pathname.startsWith(BASE) && url.pathname !== BASE.slice(0, -1)) {
      problems.push(`${pageRel}: link outside ${BASE}: ${raw}`);
      continue;
    }
    const target = url.pathname === BASE.slice(0, -1) ? join(DIST, "index.html") : fileFor(url.pathname);
    if (!target) {
      problems.push(`${pageRel}: broken link ${raw}`);
      continue;
    }
    const fragment = url.hash.slice(1);
    if (fragment && target.endsWith(".html") && !idsOf(target).has(decodeURIComponent(fragment))) {
      problems.push(`${pageRel}: missing anchor ${raw}`);
    }
  }
}

// 2. API reference covers every operation of the snapshot.
const snapshot = JSON.parse(
  readFileSync(join(ROOT, "../../packages/core/openapi/v1.snapshot.json"), "utf8"),
) as OpenApiDocument;
let operations = 0;
for (const group of groupByTag(snapshot)) {
  const file = join(DIST, "api", group.slug, "index.html");
  if (!existsSync(file)) {
    problems.push(`API reference page missing for tag "${group.tag}" (api/${group.slug}/)`);
    continue;
  }
  const ids = idsOf(file);
  for (const op of group.operations) {
    operations++;
    if (!ids.has(op.anchor)) problems.push(`API reference: ${op.method.toUpperCase()} ${op.path} has no section`);
  }
}

if (problems.length) {
  console.error(`Docs check failed: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
// biome-ignore lint/suspicious/noConsole: CLI output.
console.log(
  `Docs check passed: ${pages.length} HTML files, ${linkCount} internal links and anchors, ${operations} API operations documented.`,
);
