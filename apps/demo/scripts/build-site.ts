/**
 * Builds the single static site for hr.crow.sg: the demo at `/` and the docs at `/docs`.
 *
 *   node apps/demo/scripts/build-site.ts            (from the repo root, or `bun run demo:site`)
 *   SKIP_DOCS=1 node apps/demo/scripts/build-site.ts
 *
 * 1. Builds the demo (apps/demo → dist), including the bundle guard and size report.
 * 2. Builds the docs (apps/docs, Astro with base /docs) when that app exists. If it is missing or
 *    its build fails, the site is still produced with a small placeholder at /docs/ (and a warning),
 *    unless REQUIRE_DOCS=1, which makes a docs failure fatal (use that for a real deploy).
 * 3. Assembles apps/demo/dist-site: the demo's files at the root (with _headers, _redirects,
 *    404.html) and the docs under docs/. That folder is what Cloudflare Pages serves
 *    (wrangler.toml `pages_build_output_dir`). Nothing is uploaded: see docs/deploy-demo.md.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const demoDir = here("..");
const docsDir = here("../../docs");
const site = here("../dist-site");
const run = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

run("bun", ["run", "build"], demoDir);

let docsBuilt = false;
if (process.env.SKIP_DOCS) {
  console.warn("SKIP_DOCS is set: /docs gets a placeholder page.");
} else if (!existsSync(`${docsDir}/package.json`)) {
  console.warn("apps/docs does not exist yet: /docs gets a placeholder page.");
} else {
  try {
    run("bun", ["run", "build"], docsDir);
    docsBuilt = existsSync(`${docsDir}/dist/index.html`);
    if (!docsBuilt) throw new Error("apps/docs built but dist/index.html is missing");
  } catch (err) {
    if (process.env.REQUIRE_DOCS) throw err;
    console.warn(`The docs build failed, so /docs gets a placeholder page: ${String(err)}`);
  }
}

rmSync(site, { recursive: true, force: true });
cpSync(`${demoDir}/dist`, site, { recursive: true });
mkdirSync(`${site}/docs`, { recursive: true });
if (docsBuilt) {
  cpSync(`${docsDir}/dist`, `${site}/docs`, { recursive: true });
} else {
  writeFileSync(
    `${site}/docs/index.html`,
    `<!doctype html><html lang="en-SG"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Crow HR docs</title></head>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px">
<h1 style="font-size:20px">Crow HR documentation</h1>
<p>The documentation isn't part of this build. <a href="/">Open the demo</a> or <a href="/about-demo">read about it</a>.</p>
</body></html>\n`,
  );
}
console.warn(
  `Site ready in ${site} (docs: ${docsBuilt ? "built" : "placeholder"}). Preview: node apps/demo/scripts/serve.ts apps/demo/dist-site`,
);
