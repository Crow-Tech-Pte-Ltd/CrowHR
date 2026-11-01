## Why

People evaluating Crow HR (SME owners, HR staff, the one technical person who would self-host it) should be able to try the real product in a minute, without installing anything and without handing over any data. AGENTS.md fixes the approach: the same web app and the same `core` API running in the browser against PGlite, static, per visitor, resettable, at hr.crow.sg. It must not be a separate fake app.

## What Changes

- **packages/demo**: the browser runtime. A Web Worker owns the visitor's PGlite database (IndexedDB, one per browser), restores a build snapshot on first open (or applies core's bundled migrations and real seed on failure) and serves `createApp(deps)` with browser deps: PBKDF2 hasher, files and outbox in the visitor's database, a throwaway fixture encryption key (fresh on browser seeding), the demo clock, a console logger and the manual scheduler.
- **Transport**: the page's `fetch('/api/…')` goes to the worker; a service worker forwards images, downloads and new-tab API URLs. A worker-side cookie jar keeps core's cookie sessions and CSRF checks working unchanged (browsers forbid script access to `Cookie`/`Set-Cookie`).
- **Seed**: Kopi Kaki Pte. Ltd., a café group (office, central kitchen, three outlets, 27 people), from core's shared people seed plus a joiner and a leaver this month; July–September 2026 payroll approved and paid and October in draft, all computed by the real payroll engine; claims, leave and change requests in every state, produced through the public API as the person who would act.
- **apps/demo**: apps/web built behind a boot script with a loading screen, a persistent demo banner (Outbox, About, Docs, Self-host, Reset), the About page and the Demo outbox. apps/web gains two presentation slots (notifications footer, persona descriptions) and the persona picker the auth spec requires on the sign-in page in demo mode.
- **Data version and reset**: the database name carries `SEED_VERSION` and a content hash of demo source, core's shared people seed and migrations; a deploy with a new seed resets every visitor; Reset restores a fresh copy on demand.
- **Deployment prep (not deployed)**: Cloudflare Pages `wrangler.toml`, `_headers` (strict CSP: same origin only, WebAssembly and workers allowed, no analytics), `_redirects` that never touch `/docs`, a site build combining the demo and apps/docs, and docs/deploy-demo.md.
- **Guards**: a build plugin fails if server-only code enters the bundle; a test keeps `_redirects` in step with apps/web's routes.

## Module showcase and startup follow-up

Seed published October and current/next-week café rosters with OPN/AM/MID/PM templates;
clock attendance through the real API, approve overtime through workflows and compute October
from those feeds. Supply preferred names and management classification through people APIs,
generated KETs for recent hires, an employee acknowledgement, a work-pass expiry and a manager
shift swap. Every persona retains actionable Home work. Reports use the real paid payroll history.

At build time, run the same migrations and seed to emit a gzip PGlite data-directory snapshot.
Version it by seed-source and migration content. First visits load the snapshot instead of initdb
and browser seeding; failed loads fall back to the real seed. Anchor each visitor's clock on first
open, preserve it on reload, and re-anchor on reset. Keep everything local; deployment stays pending.

## Impact

- New: `packages/demo`, `apps/demo`, `e2e/demo`, `docs/deploy-demo.md`.
- core: `createDemoPasswordHasher` exported from the package root; new subpath `@crowhr/core/seed` re-exporting the runtime-agnostic seed helpers (no behaviour change).
- apps/web: `shell/extensions.ts` (empty by default), `sign-in/demo-personas.tsx` (rendered only when `/auth/methods` says demo mode), a footer slot in the notifications popover.
- No change for self-hosted installs.
