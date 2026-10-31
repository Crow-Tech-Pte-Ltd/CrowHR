# Architecture

Crow HR is a bun workspace. TypeScript source is the artefact: packages export `src/*.ts` directly, Node 24 runs the server with native type stripping, and Vite/Vitest consume the same files. There is no per-package build step (so: explicit `.ts` import extensions, no enums/namespaces — `erasableSyntaxOnly` enforces it).

## Packages and dependency direction

```
apps/web ──► packages/ui
   │  (types only) ──► packages/core
apps/server ──► packages/core ──► (hono, drizzle-orm, zod)
apps/demo (later) ──► apps/web + packages/core + PGlite in the browser
packages/core ──► packages/sg-rules (later: payroll uses the rule tables)
packages/sg-rules ──► nothing (pure, zero-dependency)
```

Arrows point at dependencies. Nothing depends on `apps/*`. `packages/ui` knows nothing about the API. `packages/core` never imports from `apps/*` or `packages/ui`.

| Package | Owns |
| --- | --- |
| `packages/core` | Hono app factory `createApp(deps)`, request context, error envelope, validation, services, RBAC (later), Drizzle schema + migrations (`drizzle/`), PGlite test harness (`testing/`) |
| `packages/sg-rules` | Statutory rule tables and calculators (CPF, SDL, FWL, leave, OT). Currently a placeholder |
| `packages/ui` | Crow Tech tokens, Tailwind preset, fonts, components, SG formatting (`formatMoney`, `formatDate`, `maskNric`) |
| `apps/server` | Node host: env config, node-postgres (or PGlite for dev), argon2id, disk file store, security headers, static web app + SPA fallback |
| `apps/web` | The React app: shell, routes, screens |

## Runtime-agnostic core — and why

The public demo (hr.crow.sg) runs the **same** web app against the **same** `createApp` inside the browser, backed by PGlite on IndexedDB. If core imported `pg`, `node:fs` or a native argon2 binding, that would be impossible, and the demo would drift into a fake. So core receives everything host-specific through `AppDeps`:

| Dep | Server | Tests | Browser demo (later) |
| --- | --- | --- | --- |
| `db` (Drizzle `PgDatabase`) | node-postgres pool | in-memory PGlite | PGlite + IndexedDB |
| `passwordHasher` | argon2id (`@node-rs/argon2`) | fast fake (`testing/`) | WASM or Web Crypto |
| `fileStore` | local disk | in-memory | in-memory/IndexedDB |
| `clock` | `systemClock` | `fixedClock(...)` | `systemClock` |
| `ids` | UUIDv7 via Web Crypto | same, fixed clock | same |
| `logger` | JSON lines to stdout | in-memory capture | console |

Enforced by `packages/core/tsconfig.json` (`lib: DOM + ES2023`, `types: []`, no `@types/node`) and `src/runtime-agnostic.test.ts` (fails on any Node built-in or Node-only package import under `src/`). `packages/core/testing/` is Node-only and lives outside `src/` on purpose.

Migrations: drizzle-kit writes SQL to `packages/core/drizzle/`. The server and tests apply them with Drizzle's filesystem migrator. The demo cannot read the filesystem; it will need to bundle the SQL (e.g. `import.meta.glob("…/drizzle/*.sql", { query: "?raw" })` plus the journal) and call the dialect migrator.

## Request lifecycle

```
HTTP ─► apps/server (secureHeaders) ─► core: requestContext ─► [auth: NOT IMPLEMENTED] ─► route
        validate(target, zod) ─► handler ─► service(deps, auth) ─► org-scoped query ─► JSON
        any throw ─► onError ─► { error: { code, message, requestId, details? } }
```

1. `requestContext` binds `deps`, a request id (honours a sane incoming `x-request-id`, echoes it back), a request-scoped logger, and `auth = null`.
2. Authentication middleware (auth workstream) will resolve the session into `AuthContext = { user, orgId, roles, authMethod, identity }`.
3. `validate("json" | "query" | "param", schema)` rejects bad input with `400 validation_failed` and per-field `details.issues[{ path, message }]` whose messages say how to fix the input.
4. Handlers stay thin: call a service with `deps` and the auth context.
5. Errors: throw `AppError(code, message, details?)`. Anything else becomes an opaque `500 internal`, logged with the request id; exception text never reaches the client.
6. `/api/*` that matches nothing → JSON 404. Only after that does the server's static/SPA fallback see a request, so API paths can never return `index.html`.

## Where tenancy and RBAC will be enforced

Both live in `packages/core`, never in the frontend (hiding UI is cosmetic).

- **Authentication**: a middleware in core, mounted in `createApp` before module routes, populates `c.var.auth`. `requireAuth(c)` already exists and fails closed (401) while nothing populates it.
- **Tenancy**: every tenant table has `org_id` (FK → `organisations.id`). Services receive `auth.orgId` and must only query through org-scoped data-access helpers (to be added with the first tenant table) that add `where org_id = $orgId` and set it on insert. Each tenant table gets a test proving cross-org reads/writes fail.
- **RBAC**: a permission check in core (`can(auth, "payroll:approve")`-style) called from services, not route files, so the same rule applies to every entry point. `Role` is a placeholder `string` until the RBAC change defines the matrix.

## Conventions for module authors

- **API module**: `packages/core/src/modules/<name>/routes.ts` exports `new Hono<AppEnv>()`; mount it in `src/app.ts` with `api.route("/<name>", routes)` — routes added to the returned app after `createApp` under `/api` are shadowed by the 404 catch-all. Put logic in `service.ts` next to it; tests as `*.test.ts` beside the code.
- **Schema**: one file per area in `packages/core/src/db/schema/`, re-exported from `index.ts`; snake_case column names; `uuid` primary keys generated by `deps.ids`; `timestamp with time zone`; money as integer cents in `bigint("…", { mode: "number" })` columns (never `numeric`/`real`, never floats). Then `bun run db:generate` and commit `drizzle/`. CI fails if the schema and migrations disagree.
- **Tests**: `createTestDb()` + `createTestDeps(db)` from `@crowhr/core/testing`; call `createApp(deps).request(...)`. One fresh PGlite per test file or test; close it in `afterEach`.
- **Web route**: `apps/web/src/routes/_app/<module>.tsx` (inside the shell) using `PageHeader` and `@crowhr/ui`. Add nav metadata in `src/shell/nav.ts`. Fixture data only in `src/fixtures/`, always with `<SampleDataNotice />`.
- **UI**: hairline borders by default; `Card variant="emphasis"`/`Button variant="primary"`/dialogs are the only hard-shadow surfaces. Numbers use the `num` class (Azeret Mono, tabular). Money via `formatMoney(cents)`, dates via `formatDate("YYYY-MM-DD")`, NRIC/FIN via `maskNric`.
