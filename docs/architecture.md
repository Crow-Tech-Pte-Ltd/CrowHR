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
HTTP ─► apps/server (secureHeaders) ─► core: requestContext ─► session/bearer auth ─► CSRF ─► /api/v1 router
        defineRoute: access check (requireAuth / authorize) ─► validate params, query, body ─► handler
        handler ─► service(deps, auth, grant) ─► org-scoped query ─► response parsed by its schema ─► JSON
        any throw ─► onError ─► { error: { code, message, requestId, details? } }
```

1. `requestContext` binds `deps`, a request id (honours a sane incoming `x-request-id`, echoes it back), a request-scoped logger, a per-request memo, and `auth = null`.
2. Authentication middleware resolves the session cookie or bearer token into `AuthContext` (`user`, `orgId`, `membershipId`, `employeeId`, assigned `roles`, `authMethod`, `identity`, `session`).
3. `defineRoute` runs the route's `access` rule, then validates input. Bad input → `400 validation_failed` with per-field `details.issues[{ path, message }]` whose messages say how to fix the input.
4. Handlers stay thin: call a service with `deps`, the auth context and the grant.
5. The response is parsed through the declared response schema: unknown fields fail in tests (`responseValidation: "strict"`) and are stripped in production.
6. Errors: throw `AppError(code, message, details?)`. Anything else becomes an opaque `500 internal`, logged with the request id; exception text never reaches the client.
7. `/api/*` that matches nothing → JSON 404 (unsupported `/api/v<n>` names the supported versions). Only after that does the server's static/SPA fallback see a request, so API paths can never return `index.html`.

API conventions (versioning, lists, errors, auth) are in [docs/api.md](api.md).

## Where tenancy and RBAC will be enforced

Both live in `packages/core`, never in the frontend (hiding UI is cosmetic).

- **Authentication**: a middleware in core, mounted in `createApp` before module routes, populates `c.var.auth`. `requireAuth(c)` already exists and fails closed (401) while nothing populates it.
- **Tenancy**: every tenant table has `org_id` (FK → `organisations.id`). Services receive `auth.orgId` and must only query through org-scoped data-access helpers (to be added with the first tenant table) that add `where org_id = $orgId` and set it on insert. Each tenant table gets a test proving cross-org reads/writes fail.
- **RBAC**: a permission check in core (`can(auth, "payroll:approve")`-style) called from services, not route files, so the same rule applies to every entry point. `Role` is a placeholder `string` until the RBAC change defines the matrix.

## How to add a module

A module is a directory under `packages/core/src/<module>/` (`employees/`, `leave/`, …) that exports one `ApiModule`. Every route is declared with `defineRoute`: that one declaration validates input, checks permissions, serialises output and generates the OpenAPI document. Do not register raw Hono routes under `/api/v1`; they would be undocumented and invisible to the cross-org test helper.

```ts
// packages/core/src/teams/routes.ts
import { z } from "zod";
import { csvEnum, listQuery, orderByFor, pageOf, toLimitOffset } from "../http/list.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { AppError } from "../errors.ts";

const team = z.object({ id: z.uuid(), name: z.string(), status: z.enum(["active", "archived"]) });

export const teamsModule = defineModule({
  name: "teams",
  basePath: "/teams", // → /api/v1/teams
  tag: "Teams",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "List teams",
      access: { permission: "org_structure:read" }, // a key of MATRIX in access/matrix.ts
      request: {
        query: listQuery({ sort: ["name"], defaultSort: "name", search: true, filters: { status: csvEnum(["active", "archived"]) } }),
      },
      responses: { 200: pageOf(team) },
      handler: async ({ deps, auth, query }) => listTeams(deps, auth, query), // service in ./service.ts
    }),
    defineRoute({
      method: "get",
      path: "/:id",
      summary: "Get a team",
      access: { permission: "org_structure:read" },
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: team },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => {
        const found = await getTeam(deps, auth, params.id); // org-scoped query
        if (!found) throw new AppError("not_found", "That team doesn't exist.");
        return found; // parsed through `team`; extra columns fail tests
      },
    }),
  ],
});
```

Then add one line to `V1_MODULES` in `packages/core/src/app.ts` (`teamsModule,`), run `bun run openapi:generate`, and commit the updated snapshot.

Rules of the road:

- **`access`** is required: `"public"`, `"authenticated"` (any member; the handler limits itself to the caller's own data) or `{ permission }`. Permissions come from the matrix in `access/matrix.ts`; to add a row, add a key there with the cells from the access-control spec. The handler receives `grant` and must narrow per record: `await grant.assertEmployee(row.employeeId)` (404 when out of scope) or `where(and(orgFilter, await grant.employeeFilter(table.employeeId)))` for lists.
- **Sensitive actions** set `recentAuth: true` (password, MFA, email, security settings, SSO, role grants, NRIC/bank reveal, sensitive exports).
- **Responses** declare every status the handler can produce. The lowest 2xx is the default; return `reply(202, body)` for another declared status, `undefined` for a declared `204: null`, or a `Response` for a raw response (redirect, CSV) declared as `{ description, contentType? }`.
- **Errors** are `AppError(code, message)` with a message that says how to fix the problem. List extra codes in `errors`.
- **Sensitive fields** in response schemas are wrapped in `sensitive(schema, "salary" | "nric" | "bank" | "medical")`.
- **Lists** follow docs/api.md "Lists" via `listQuery` / `pageOf`.
- **Services, not routes**, hold logic and queries, so the same rules apply to every entry point (HTTP, jobs, CLI).

## Conventions for module authors

- **Schema**: one file per area in `packages/core/src/db/schema/`, re-exported from `index.ts`; snake_case column names; `uuid` primary keys generated by `deps.ids`; `timestamp with time zone`; money as integer cents in `bigint("…", { mode: "number" })` columns (never `numeric`/`real`, never floats). Then `bun run db:generate` and commit `drizzle/`. CI fails if the schema and migrations disagree.
- **Tests**: `createTestDb()` + `createTestDeps(db)` from `@crowhr/core/testing`; call `createApp(deps).request(...)`. Pass stub modules with `createApp(deps, { modules: [...] })`. One fresh PGlite per test file or test; close it in `afterEach`.
- **Web route**: `apps/web/src/routes/_app/<module>.tsx` (inside the shell) using `PageHeader` and `@crowhr/ui`. Add nav metadata in `src/shell/nav.ts`. Fixture data only in `src/fixtures/`, always with `<SampleDataNotice />`.
- **UI**: hairline borders by default; `Card variant="emphasis"`/`Button variant="primary"`/dialogs are the only hard-shadow surfaces. Numbers use the `num` class (Azeret Mono, tabular). Money via `formatMoney(cents)`, dates via `formatDate("YYYY-MM-DD")`, NRIC/FIN via `maskNric`.
