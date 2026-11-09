## Why
Operators (starting with Crow Tech's own staging and production installs) need to see crashes, failed background jobs and slow requests without reading container logs. GlitchTip and Sentry accept the official Sentry SDKs. The product promise stays: nothing is sent unless the operator configures their own service, and Crow Tech receives nothing.

## What Changes
- Server (`apps/server`): optional Sentry SDK (`@sentry/node` 11), preloaded by `instrument.ts` (`node --import`, Dockerfile CMD and `bun run dev`) when `SENTRY_DSN` is set. Hono, HTTP and node-postgres are traced (`SENTRY_TRACES_SAMPLE_RATE`, default 0.2; never health checks or static files). Unhandled errors and every `error` log entry become issues; log entries are forwarded as Sentry logs (`SENTRY_ENABLE_LOGS`). `AppError` (expected failures) is never reported.
- Web (`apps/web`): when `SENTRY_BROWSER_DSN` is set the server writes the settings into `index.html` at runtime and allows the DSN origin in the page CSP; the web app then lazy-loads `@sentry/react` (errors, React root hooks, route error screens, TanStack Router tracing). Without it the SDK chunk is never downloaded.
- Release `crowhr@<version>+<commit>` (`CROWHR_GIT_SHA` build argument) or `SENTRY_RELEASE`; `SENTRY_ENVIRONMENT`.
- Privacy: SDK 11 collects bodies, cookies, headers, query strings, IPs, user info, DB values and local variables by default; all are turned off and scrubbed again before sending. No session replay.
- Startup validation of every new variable; configuration reference, `.env.example` and privacy pages updated.

## Capabilities
### Modified Capabilities
- `self-hosting`: optional error monitoring.

## Non-goals
- Mobile apps: they keep zero third-party SDKs (`scripts/android-audit.sh`).
- The public demo: it never reports.
- Source-map upload or any sentry.io-specific CI step.
- Build-time DSNs: the published image must not contain any install's DSN.
- User identification on events.

## Impact
`apps/server` (monitoring module, config, http, main, instrument), `apps/web` (monitoring, entry, route error), Dockerfile, `docker-compose.yml`, docs. New dependencies `@sentry/node` and `@sentry/react`. No database or API change.
