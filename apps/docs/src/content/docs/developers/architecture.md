---
title: Architecture
description: How the Crow HR codebase is organised - bun workspace packages, the runtime-agnostic core, the request lifecycle, tenancy, RBAC and audit.
---

Crow HR is a TypeScript monorepo (bun workspaces). Source is the artefact: packages export `src/*.ts` directly, Node 24 runs the server with native type stripping, and Vite and Vitest consume the same files. There is no per-package build step, so imports use explicit `.ts` extensions and enums and namespaces are not allowed (`erasableSyntaxOnly`).

The contributor-facing version of this page, with more code, is `docs/architecture.md` in the repository.

## Packages

```
apps/web ──► packages/ui
   │  (types only) ──► packages/core
apps/server ──► packages/core ──► packages/sg-rules
apps/docs (this site) ──► reads packages/core sources at build time
packages/sg-rules ──► nothing (pure, zero-dependency)
```

| Package | Owns |
| --- | --- |
| `packages/core` | Hono app factory `createApp(deps)`, request context, error envelope, validation, services, permissions, Drizzle schema and migrations, the OpenAPI generator, a PGlite test harness (`testing/`). |
| `packages/sg-rules` | Effective-dated, cited statutory tables and calculators: CPF, SDL, SHG, FWL, Employment Act coverage, overtime, incomplete-month salary, leave entitlements, public holidays, deduction limits, payment deadlines. |
| `packages/ui` | Crow Tech tokens, Tailwind preset, self-hosted fonts, components, Singapore formatting (`formatMoney`, `formatDate`, `maskNric`). |
| `apps/server` | The Node host: configuration, node-postgres (or PGlite in development), argon2id hashing, disk file storage, security headers, migrations, backups, the scheduler, the `crowhr` CLI, and serving the built web app. |
| `apps/web` | The React app (Vite, React 19, TanStack Router and Query, Tailwind 3.4). |
| `apps/docs` | This documentation site (Astro Starlight). |

## A runtime-agnostic core

`packages/core` never imports Node built-ins or Node-only packages. Everything host-specific arrives through `AppDeps`:

| Dependency | Server | Tests | Planned browser demo |
| --- | --- | --- | --- |
| `db` (Drizzle) | node-postgres pool | in-memory PGlite | PGlite on IndexedDB |
| `passwordHasher` | argon2id | fast fake | Web Crypto |
| `fileStore` | local disk | in-memory | in-memory / IndexedDB |
| `clock` | system clock | fixed or movable clock | system clock |
| `ids` | UUIDv7 via Web Crypto | same, fixed clock | same |
| `logger` | JSON lines on stdout | in-memory capture | console |

The reason is the planned [public demo](/docs/coming-soon/demo/), which would run the same core in the browser. A test (`src/runtime-agnostic.test.ts`) fails on any Node-only import under `src/`.

## Request lifecycle

```
HTTP ─► apps/server (security headers, proxy trust) ─► core: request context ─► session or bearer auth ─► CSRF
     ─► /api/v1 router ─► defineRoute: access check ─► validate params, query, body ─► handler
     ─► service(deps, auth, grant) ─► org-scoped query ─► response parsed by its schema ─► JSON
     any throw ─► { error: { code, message, requestId, details? } }
```

- Every route is declared with `defineRoute`. That one declaration validates input, checks permissions, serialises output and generates the OpenAPI document.
- Responses are parsed through their declared schema: unknown fields fail in tests and are stripped in production.
- Errors are `AppError(code, message)`; anything else becomes an opaque `500 internal`, logged with the request ID.
- Unmatched `/api/*` paths answer JSON 404 before the static web app sees them, so API paths never return `index.html`.

## Tenancy, permissions and audit

- **Tenancy**: every tenant table has `org_id` (a schema test enforces it), references between tenant tables are composite foreign keys `(org_id, id)`, and queries go through `orgScope(db, auth)`. A sweep test calls every route with another organisation's IDs and expects 404.
- **Permissions**: the matrix is data in `access/matrix.ts`. `authorize(c, permission)` returns a grant with a scope (`all`, `team`, `own`, `assigned`); handlers narrow per record and answer 404 outside scope. See [roles and permissions](/docs/roles-and-permissions/).
- **Sensitive data**: response schemas mark fields `sensitive(…, "salary" | "nric" | "bank" | "medical")`; NRIC/FIN and bank numbers are encrypted with AES-256-GCM and have a keyed HMAC blind index for lookups.
- **Audit**: `recordAudit` appends to a per-organisation SHA-256 hash chain inside the same transaction; the database rejects updates and deletes on the audit table.

## Effective-dated data

Records that change over time (employment terms, compensation, allowances, bank accounts, work schedule versions) use half-open `[effective_from, effective_to)` ranges, where `null` means "until further notice". Writes go through `planInsert`, which closes the version in force and handles future-dated versions in one transaction. Status such as "Scheduled" or "Leaving on" is derived from dates and the injected clock in Asia/Singapore, never stored.

## Money

Money is integer cents (`number`, always a safe integer), stored as `bigint` columns in mode `number`. Never floats. Rounding is explicit and named, for example `roundHalfUpToDollar`.

## Background work

Escalations, reminders, the email outbox and date-triggered transitions run in `tick(deps, now)`, called by the server every 60 seconds. Work is claimed with `FOR UPDATE SKIP LOCKED` or de-duplicated with unique keys, so two replicas never double-process. Core never uses timers. Scheduled backups run on the same scheduler in `apps/server` because `pg_dump` is Node-only.
