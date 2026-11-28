## ADDED Requirements

### Requirement: Self-hosted runtime

The self-hosted image SHALL run the Crow HR server and CLI on a pinned Bun release and continue to support the existing Docker Compose install and encrypted backup workflows.

#### Scenario: Upgrading an existing install

- **WHEN** the operator installs the new image using the existing Compose volumes and configuration
- **THEN** the server starts with the same database and encryption material and the existing CLI commands remain available

### Requirement: Opt-in Bun tracing

With a configured `SENTRY_DSN`, the Bun server SHALL send redacted errors, enabled app logs and sampled API transactions to a Sentry-compatible collector. Sampled transactions SHALL use route templates and include PostgreSQL query timings without query parameters. Health and static requests are excluded from tracing. Without a server DSN, the server SHALL load no SDK and send no events.

#### Scenario: A request accesses PostgreSQL

- **WHEN** an API request is sampled and its handler executes PostgreSQL queries
- **THEN** a route-named transaction contains the child query spans, with no query text or bind values on those spans

#### Scenario: A PostgreSQL query fails

- **WHEN** an API request fails unexpectedly while executing a PostgreSQL query
- **THEN** the error is linked to the request, and its data and logs are redacted before they leave the process
