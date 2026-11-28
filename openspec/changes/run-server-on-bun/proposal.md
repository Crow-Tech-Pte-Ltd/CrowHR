## Why

The local comparison with PostgreSQL found lower server memory use and a faster payroll read under Bun. The existing Node SDK's automatic request and database instrumentation emitted no transactions when the server ran under Bun.

## What changes

- Run the self-hosted app and its CLI on pinned Bun with the existing HTTP adapter, PostgreSQL driver and native Argon2 dependency.
- Keep opt-in, Sentry-compatible server errors, structured logs and sampled request and PostgreSQL traces working on Bun.
- Run Playwright's app servers and the container install smoke on Bun.

## Capabilities

### New capabilities

- `server-runtime`: Supported self-hosted runtime and tracing behavior.

### Modified capabilities

None.

## Impact

Self-hosted image, server launch scripts, server monitoring, contributor tooling and CI. Database schema, HTTP API and browser demo architecture stay the same.
