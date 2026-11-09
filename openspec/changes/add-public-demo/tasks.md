## 1. Runtime (packages/demo)

- [x] 1.1 `migrations.test.ts` then bundle core's drizzle SQL + journal and apply them with the dialect migrator
- [x] 1.2 `cookie-jar.test.ts`, `bridge.test.ts` then the cookie-preserving bridge in front of `createApp`
- [x] 1.3 `client.test.ts` then the page-side RPC client and the `/api` fetch interceptor
- [x] 1.4 Web Worker: PGlite on IndexedDB, data-versioned database name, durable flush after writes, reset
- [x] 1.5 Service worker for non-fetch API requests (receipt images, downloads)
- [x] 1.6 `clock.test.ts` then the demo clock anchored on the seed's date
- [x] 1.7 `tick.test.ts` then the manual scheduler tick (workflows task 5.4) and the Demo outbox mailer

## 2. Seed

- [x] 2.1 `seed.test.ts` then Kopi Kaki: core's people seed + third outlet, joiner and leaver this month
- [x] 2.2 Four months of payroll through the API and the real engine (Jul–Sep paid, Oct draft with warnings only)
- [x] 2.3 Claims (draft, waiting, approved, rejected, reimbursed), leave (approved and waiting) and change requests; approvals waiting for every persona
- [x] 2.4 Attendance clock-ins and approved overtime claims feeding October's run

## 3. App (apps/demo, apps/web slots)

- [x] 3.1 Loading screen with boot stages; first-load timing recorded (`window.__crowhrDemo`)
- [x] 3.2 Persona picker on the sign-in page in demo mode; SSO buttons visible and disabled
- [x] 3.3 Banner (Outbox, About, Docs, Self-host, Reset), Demo outbox in the notifications popover
- [x] 3.4 About page listing every demo-only behaviour; docs/limitations.md "Public demo"
- [x] 3.5 One-tab lock with "Use it here instead"

## 4. Build and deployment prep

- [x] 4.1 Bundle guard (build fails on server-only modules) and size report
- [x] 4.2 Pre-compressed PGlite binaries
- [x] 4.3 `_headers`, `_redirects`, `404.html`, `wrangler.toml`, site build with docs at /docs, local Pages-like preview server
- [x] 4.4 docs/deploy-demo.md
- [x] 4.5 Deploy to Cloudflare Pages and point hr.crow.sg at it — needs Daniel's approval — approved and deployed 9 Nov 2026 (project `crowhr-demo`, main account). The first upload showed deep links 308-redirecting to `/` (Pages' clean URLs on a rewrite to `/index.html`); `_redirects` now rewrites to `/`

## 5. Tests

- [x] 5.1 Playwright against the built demo: load, payroll admin opens the draft run and a CPF working, manager approves a claim (receipt via the service worker), reset re-seeds
- [x] 5.2 Screenshots at 1440 and 390 (`SHOTS_DIR=… playwright test -c e2e/demo/playwright.demo.config.ts shots`)

## 6. Complete module showcase and snapshot startup

- [x] 6.1 Regression tests for preferred names, manager flags, published October/current/next-week rosters, late clock-ins and approved OT in October payroll
- [x] 6.2 Generate KETs for recent hires, acknowledgement work for the employee, and an expiring work-pass document through the API
- [x] 6.3 Build a gzip PGlite snapshot from the real seed; hash seed sources and migrations; restore on first visit with browser-seed fallback and per-visitor clock anchoring
- [x] 6.4 Regression tests for snapshot round-trip, bad/missing/version-mismatched snapshot fallback, persistence and reset
- [x] 6.5 Extend built-demo Playwright coverage for fed OT, swap approval, document acknowledgement and payroll cost reports; measure before/after with installed Chromium
- [x] 6.6 Update demo docs and About; run root check; commit locally without pushing
