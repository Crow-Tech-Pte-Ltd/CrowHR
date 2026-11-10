## 1. Server
- [x] 1.1 `apps/server` monitoring config: env parsing, defaults, startup problems (`monitoring/config.test.ts`).
- [x] 1.2 `apps/server` SDK options: data collection off, scrubbing, error filter, trace sampling (`monitoring/sentry.test.ts`).
- [x] 1.3 `apps/server` logger bridge: error entries to issues, entries to logs, LOG_LEVEL respected (`monitoring/logger.test.ts`).
- [x] 1.4 `apps/server` browser settings in `index.html` and CSP origin only when configured (`http.test.ts`).
- [x] 1.5 `instrument.ts` preload in the Dockerfile CMD and `bun run dev`; flush on shutdown (manual run against a local fake ingest server).
## 2. Web
- [x] 2.1 `apps/web` reads the page settings, lazy-loads the SDK, skips API errors, scrubs events (`monitoring.test.ts`).
## 2a. Review fixes
- [x] 2a.1 Mask failed-query values, PostgreSQL quoted input, NRIC/FIN and emails in events and forwarded logs; no console breadcrumbs; no trace headers to third parties (`monitoring/redact.ts`, `sentry.test.ts`, `logger.test.ts`).
- [x] 2a.2 Browser: remove `/invite/$token` and `/reset/$token` tokens from URLs, spans and breadcrumbs; mask element labels; no console breadcrumbs or INP spans (`monitoring.test.ts`).
- [x] 2a.3 DSN validation as strict as the SDK's parser (numeric project ID, no trailing slash) (`config.test.ts`).
- [x] 2a.4 The demo build replaces the SDK module with a stub and its bundle guard rejects `@sentry/*` (`apps/demo/scripts/site.test.ts`).
- [x] 2a.5 Sentry SDKs pinned to 10.78.0: every `@sentry/node` 11.x pulls in the FSL-licensed Sentry CLI, which `bun run licences:check` rejects. API transactions are named after their route by a hook in `apps/server/src/http.ts` (`http.test.ts`); unhandled request errors reach monitoring through the logger bridge, which skips `AppError` (`logger.test.ts`).
## 3. Documentation
- [x] 3.1 Configuration reference, `.env.example`, privacy pages (`apps/docs/tests/env-vars.test.ts`).
