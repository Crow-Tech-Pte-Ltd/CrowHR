# Deploying the public demo to hr.crow.sg

The live site is the Cloudflare Pages project `crowhr-demo`, custom domain `hr.crow.sg` (a proxied
CNAME to `crowhr-demo.pages.dev`). Nothing in the repository deploys automatically: a maintainer
builds and uploads it, and every step that touches Cloudflare or DNS needs the maintainer's approval
(AGENTS.md hard rule 1).

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

The demo build now runs `scripts/build-snapshot.ts` after Vite: it applies the real migrations
and seed, then emits `dist/assets/demo-<data-version>.tar.gz` (about 7.6 MiB gzip). Keep that
asset with the matching build. The worker downloads it alongside WASM, validates/decompresses
it and loads it with PGlite `loadDataDir`; missing or invalid snapshots fall back to the real
browser seed. The build checkpoints Postgres before dumping it so visitors skip replaying the seed's WAL history. The distribution also includes optional language fonts; they are fetched only
when needed. Nothing is uploaded by the build.

## Singpass in the demo (optional build settings)

The demo can offer a real Singpass login (then HR admin or Employee; nothing about the person is kept). It needs a Crow HR server acting as the Singpass relying party (see the Singpass guide, "Public demo"); for hr.crow.sg that is `https://hr-demo.crow.sg` on S4.

| Build-time variable | Value for hr.crow.sg | Effect |
| --- | --- | --- |
| `VITE_SINGPASS_LOGO_SRC` | `/branding/singpass-logo.svg` | The Singpass button shows the official logo. Copy Singpass's full-colour logo (from their button specification download) to `apps/demo/dist-site/branding/singpass-logo.svg` after building. It is never committed. |
| `VITE_DEMO_SINGPASS_START_URL` | `https://hr-demo.crow.sg/api/v1/auth/oidc/<production method id>/start?purpose=demo` | Turns the demo's Singpass button on. Only set it once that method has a **production** client ID: Singpass staging accepts test accounts only. Unset, the button is shown disabled. |
| `VITE_TRY_URL` | `https://hr-demo.crow.sg/try` | The demo banner ("Try it on your phone") and About this demo link to a server's try page, where visitors get their own demo company for the mobile apps (openspec add-demo-companies). Set it only once that server runs with `DEMO_COMPANIES=1`. Unset, no link is shown. |

## Before deploying (local, no approval needed)

1. `bun install`
2. `bun run check` (green)
3. `REQUIRE_DOCS=1 VITE_SINGPASS_LOGO_SRC=/branding/singpass-logo.svg bun run demo:site` (plus
   `VITE_DEMO_SINGPASS_START_URL` once production Singpass is approved) — builds the demo (with the
   server-code bundle guard) and the docs, and assembles `apps/demo/dist-site/`. Then copy the logo
   to `apps/demo/dist-site/branding/singpass-logo.svg`.
4. `bun run demo:e2e` twice (the second run proves a fresh visitor gets a fresh copy), then
   `node apps/demo/scripts/serve.ts apps/demo/dist-site` and check by hand at
   http://127.0.0.1:5181: first load, a persona, `/payroll`, `/about-demo`, `/docs/`, Reset.
   The preview server applies `_headers` and `_redirects` like Pages does.

## Deploying (needs approval)

These use Crow Tech's Cloudflare account. Do not run them with any other account, and do not run
them without approval.

1. **Create the Pages project** (once): in the Cloudflare dashboard, Workers & Pages → Create →
   Pages → "Upload assets" (Direct Upload), project name `crowhr-demo`, production branch `main`.
   Or with Wrangler, logged in to that account: `bunx wrangler pages project create crowhr-demo --production-branch main`.
   **Wrangler 4.159+** sends `pages` commands to the new Workers-based Pages and fails on this
   folder ("Missing entry-point to Worker script or to assets directory"). Add `--force` to use
   classic Pages, which this site is built for (`_headers`, `_redirects`). The project was created
   with the API: `POST /accounts/<id>/pages/projects {"name":"crowhr-demo","production_branch":"main"}`.
   Do not connect the GitHub repository (Git integration would build on Cloudflare with a
   different toolchain and deploy without approval).
2. **Upload**: from `apps/demo/`, `bunx wrangler pages deploy dist-site --project-name crowhr-demo --branch main --force`
   (with `CLOUDFLARE_ACCOUNT_ID` and the account's key from the vault). Check the `*.crowhr-demo.pages.dev` preview URL first:
   - the demo loads its snapshot and signs in; no console errors; DevTools → Network shows requests to
     this origin only;
   - response headers on `/` include the CSP from `_headers`; `/docs/` has the docs CSP;
   - `/payroll` (deep link) serves the app with status 200, not a 308 to `/`; `/docs/quick-start/`
     serves the docs; `/nope` is a 404. Pages answers a rewrite to `/index.html` with a 308 to `/`,
     so `_redirects` rewrites to `/` (the preview server now does the same, and `site.test.ts`
     refuses `.html` rewrite targets).
3. **Custom domain**: Pages project → Custom domains → add `hr.crow.sg`. Cloudflare creates the
   `CNAME hr → crowhr-demo.pages.dev` record if crow.sg's DNS is on Cloudflare; otherwise add that
   CNAME at the DNS host. This is the only DNS change. Wait for the certificate, then repeat the
   checks on https://hr.crow.sg.
4. **Cloudflare settings**: leave Web Analytics **off** (the demo promises no analytics), no
   Rocket Loader (it rewrites scripts and breaks the CSP), no Email Obfuscation, no injected
   scripts of any kind.

## Updating

Run steps 1–4 of "Before deploying", then `bunx wrangler pages deploy` again. Visitors keep their
data unless the data version changes, in which case their next visit starts from a fresh copy.
`apps/demo/scripts/data-version.ts` hashes demo source, core's shared people seed and migrations,
with `packages/demo/src/version.ts`'s release label as a prefix. Seed edits automatically change
the asset URL and IndexedDB name; a manual version bump is optional.

## Rolling back

Pages → Deployments → pick the previous deployment → "Rollback to this deployment". A rollback to a
build with an older data version also starts visitors fresh (the version is part of the database
name; the old one is deleted on the next visit).

## Taking it down

Remove the custom domain from the Pages project (and the CNAME if it was added by hand), then
delete the project. Visitors' copies stay in their own browsers until they clear site data.

## Local first-visit measurements

Use the existing demo Playwright config and an installed Chromium; do not download browsers:

```sh
DEMO_PERFORMANCE=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  bunx playwright test -c e2e/demo/playwright.demo.config.ts performance.demo.ts
```

Each sample uses a fresh browser context and IndexedDB. The metric is navigation start to the
app/banner being mounted (`window.__crowhrDemo.readyMs`), without network or CPU throttling.
Measurements are local observations, not a hosted-network service level. With the build-time
snapshot, three fresh visits took about 1.2 s each (median 1,199 ms, worker startup about 1 s),
against about 4.9 s when the browser seeded the database itself.
