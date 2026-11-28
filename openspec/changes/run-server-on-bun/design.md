## Runtime

Use Bun 1.4.5 as the runtime, including for CLI commands. Keep the Hono Node-compatible HTTP adapter that ran in the benchmark and the existing `pg` connection pool and Argon2 implementation. Run Node 24 for repository tooling that uses it. Keep the shipping image pinned and verify the app listens, completes install and backup workflows, and shuts down on SIGTERM.

## Monitoring

Load the Bun SDK only when a server DSN is configured. Instrument API requests at the app boundary and PostgreSQL execution on the configured pool's clients. Use route templates for names and give query spans a fixed name and database type. Apply the shared event and log redaction before sending envelopes. Keep the existing Node path for tooling and retain browser opt-in behavior.

Verify the actual Bun process and PostgreSQL against a local Sentry-compatible envelope receiver. Cover successful and failing queries, route templates, synthetic sensitive data, expected errors and health probes.
