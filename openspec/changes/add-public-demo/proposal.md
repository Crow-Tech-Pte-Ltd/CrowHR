## Why

People evaluating Crow HR (SME owners, HR staff, the one technical person who would self-host it) should be able to try the real product in a minute, without installing anything and without handing over any data. AGENTS.md fixes the approach: the same web app and the same `core` API running in the browser against PGlite, static, per visitor, resettable, at hr.crow.sg. It must not be a separate fake app.

## What Changes

- **packages/demo**: the browser runtime. A Web Worker owns the visitor's PGlite database (IndexedDB, one per browser), applies core's real migrations (bundled), seeds a fictional company on first open and serves `createApp(deps)` with browser deps: PBKDF2 hasher, files and outbox in the visitor's database, a per-browser encryption key, the demo clock, a console logger and the manual scheduler.
- **Transport**: the page's `fetch('/api/…')` goes to the worker; a service worker forwards images, downloads and new-tab API URLs. A worker-side cookie jar keeps core's cookie sessions and CSRF checks working unchanged (browsers forbid script access to `Cookie`/`Set-Cookie`).
- **Seed**: Kopi Kaki Pte. Ltd., a café group (office, central kitchen, three outlets, 27 people), from core's shared people seed plus a joiner and a leaver this month; July–September 2026 payroll approved and paid and October in draft, all computed by the real payroll engine; claims, leave and change requests in every state, produced through the public API as the person who would act.
- **apps/demo**: apps/web built behind a boot script with a loading screen, a persistent demo banner (Outbox, About, Docs, Self-host, Reset), the About page and the Demo outbox. apps/web gains two presentation slots (notifications footer, persona descriptions) and the persona picker the auth spec requires on the sign-in page in demo mode.
- **Data version and reset**: the database name carries `SEED_VERSION` and a hash of the migrations; a deploy with a new seed resets every visitor; Reset re-seeds on demand.
- **Deployment prep (not deployed)**: Cloudflare Pages `wrangler.toml`, `_headers` (strict CSP: same origin only, WebAssembly and workers allowed, no analytics), `_redirects` that never touch `/docs`, a site build combining the demo and apps/docs, and docs/deploy-demo.md.
- **Guards**: a build plugin fails if server-only code enters the bundle; a test keeps `_redirects` in step with apps/web's routes.

## Impact

- New: `packages/demo`, `apps/demo`, `e2e/demo`, `docs/deploy-demo.md`.
- core: `createDemoPasswordHasher` exported from the package root; new subpath `@crowhr/core/seed` re-exporting the runtime-agnostic seed helpers (no behaviour change).
- apps/web: `shell/extensions.ts` (empty by default), `sign-in/demo-personas.tsx` (rendered only when `/auth/methods` says demo mode), a footer slot in the notifications popover.
- No change for self-hosted installs.
