# Deploying the public demo to hr.crow.sg

**Status: not deployed. Every step that touches Cloudflare or DNS needs Daniel's explicit approval
before it is run** (AGENTS.md hard rule 1). Nothing in the repository deploys automatically.

hr.crow.sg is one static Cloudflare Pages site: the in-browser demo at `/` and the documentation
(apps/docs) at `/docs`. There is no backend, no Pages Function, no binding, no environment variable
and no analytics. Visitors' data never leaves their browser.

## What gets deployed

`apps/demo/dist-site/`, built by `bun run demo:site`:

| Path | Source | Notes |
| --- | --- | --- |
| `/`, `/assets/*`, `/demo-sw.js` | `apps/demo` (Vite) | The web app, the API worker, PGlite's binaries as `.gz` |
| `/_headers` | `apps/demo/public/_headers` | CSP and security headers; `/docs/*` has its own CSP |
| `/_redirects` | `apps/demo/public/_redirects` | App routes → `/index.html` (200); never `/docs/*` or `/assets/*` |
| `/404.html` | `apps/demo/public/404.html` | Unknown paths (including `/api/*` when the service worker isn't active) |
| `/docs/*` | `apps/docs/dist` (Astro, `base: "/docs"`) | Placeholder page if the docs build is skipped or fails |

Size: about 10 MB on disk, ~7 MB transferred on a first visit. The largest file (PGlite's
WebAssembly, gzip) is ~3.3 MB, well under Pages' 25 MiB per-file limit.

## Before deploying (local, no approval needed)

1. `bun install`
2. `bun run check` (green)
3. `REQUIRE_DOCS=1 bun run demo:site` — builds the demo (with the server-code bundle guard) and the
   docs, and assembles `apps/demo/dist-site/`.
4. `bun run demo:e2e` twice (the second run proves a fresh visitor gets a fresh seed), then
   `node apps/demo/scripts/serve.ts apps/demo/dist-site` and check by hand at
   http://127.0.0.1:5181: first load, a persona, `/payroll`, `/about-demo`, `/docs/`, Reset.
   The preview server applies `_headers` and `_redirects` like Pages does.

## Deploying (needs Daniel's approval)

These use Daniel's Cloudflare account. Do not run them with any other account, and do not run them
without approval.

1. **Create the Pages project** (once): in the Cloudflare dashboard, Workers & Pages → Create →
   Pages → "Upload assets" (Direct Upload), project name `crowhr-demo`, production branch `main`.
   Or with Wrangler, logged in as Daniel: `bunx wrangler pages project create crowhr-demo --production-branch main`.
   Do not connect the GitHub repository (the repo is private until approved; Git integration would
   also build on Cloudflare with a different toolchain).
2. **Upload**: from `apps/demo/`, `bunx wrangler pages deploy` (reads `wrangler.toml`:
   `pages_build_output_dir = "dist-site"`). Check the `*.crowhr-demo.pages.dev` preview URL first:
   - the demo loads, seeds and signs in; no console errors; DevTools → Network shows requests to
     this origin only;
   - response headers on `/` include the CSP from `_headers`; `/docs/` has the docs CSP;
   - `/payroll` (deep link) serves the app; `/docs/quick-start/` serves the docs; `/nope` is a 404.
3. **Custom domain**: Pages project → Custom domains → add `hr.crow.sg`. Cloudflare creates the
   `CNAME hr → crowhr-demo.pages.dev` record if crow.sg's DNS is on Cloudflare; otherwise add that
   CNAME at the DNS host. This is the only DNS change. Wait for the certificate, then repeat the
   checks on https://hr.crow.sg.
4. **Cloudflare settings**: leave Web Analytics **off** (the demo promises no analytics), no
   Rocket Loader (it rewrites scripts and breaks the CSP), no Email Obfuscation, no injected
   scripts of any kind.

## Updating

Run steps 1–4 of "Before deploying", then `bunx wrangler pages deploy` again. Visitors keep their
data unless the data version changed (`packages/demo/src/version.ts` `SEED_VERSION`, or any new
migration), in which case their next visit starts from a fresh seed automatically. Bump
`SEED_VERSION` whenever the seed changes.

## Rolling back

Pages → Deployments → pick the previous deployment → "Rollback to this deployment". A rollback to a
build with an older data version also starts visitors fresh (the version is part of the database
name; the old one is deleted on the next visit).

## Taking it down

Remove the custom domain from the Pages project (and the CNAME if it was added by hand), then
delete the project. Visitors' copies stay in their own browsers until they clear site data.
