## 1. Server
- [x] 1.1 `apps/server` monitoring config: env parsing, defaults, startup problems (`monitoring/config.test.ts`).
- [x] 1.2 `apps/server` SDK options: data collection off, scrubbing, error filter, trace sampling (`monitoring/sentry.test.ts`).
- [x] 1.3 `apps/server` logger bridge: error entries to issues, entries to logs, LOG_LEVEL respected (`monitoring/logger.test.ts`).
- [x] 1.4 `apps/server` browser settings in `index.html` and CSP origin only when configured (`http.test.ts`).
- [x] 1.5 `instrument.ts` preload in the Dockerfile CMD and `bun run dev`; flush on shutdown (manual run against a local fake ingest server).
## 2. Web
- [x] 2.1 `apps/web` reads the page settings, lazy-loads the SDK, skips API errors, scrubs events (`monitoring.test.ts`).
## 3. Documentation
- [x] 3.1 Configuration reference, `.env.example`, privacy pages (`apps/docs/tests/env-vars.test.ts`).
