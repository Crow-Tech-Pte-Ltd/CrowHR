# Architecture

Crow HR is a bun workspace. TypeScript source is the artefact: packages export `src/*.ts` directly, Node 24 runs the server with native type stripping, and Vite/Vitest consume the same files. There is no per-package build step (so: explicit `.ts` import extensions, no enums/namespaces — `erasableSyntaxOnly` enforces it).

## Packages and dependency direction

```
apps/web ──► packages/ui
   │  (types only) ──► packages/core
apps/server ──► packages/core ──► (hono, drizzle-orm, zod)
apps/demo ──► apps/web + packages/demo (──► packages/core + PGlite, in a Web Worker)
packages/core ──► packages/sg-rules (later: payroll uses the rule tables)
packages/sg-rules ──► nothing (pure, zero-dependency)
```

Arrows point at dependencies. Nothing depends on `apps/*`. `packages/ui` knows nothing about the API. `packages/core` never imports from `apps/*` or `packages/ui`.

| Package | Owns |
| --- | --- |
| `packages/core` | Hono app factory `createApp(deps)`, request context, error envelope, validation, services, RBAC (later), Drizzle schema + migrations (`drizzle/`), PGlite test harness (`testing/`) |
| `packages/sg-rules` | Effective-dated, cited statutory rule tables and calculators (CPF, SDL, SHG, FWL, Employment Act leave, overtime, salary). Verification record in `packages/sg-rules/VERIFICATION.md`; ≥ 95% line coverage enforced by `bun run check` |
| `packages/ui` | Crow Tech tokens, Tailwind preset, fonts, components, SG formatting (`formatMoney`, `formatDate`, `maskNric`) |
| `apps/server` | Node host: env config, node-postgres (or PGlite for dev), argon2id, disk file store, security headers, static web app + SPA fallback |
| `apps/web` | The React app: shell, routes, screens |

## Runtime-agnostic core — and why

The public demo (hr.crow.sg) runs the **same** web app against the **same** `createApp` inside the browser, backed by PGlite on IndexedDB. If core imported `pg`, `node:fs` or a native argon2 binding, that would be impossible, and the demo would drift into a fake. So core receives everything host-specific through `AppDeps`:

| Dep | Server | Tests | Browser demo (`packages/demo`) |
| --- | --- | --- | --- |
| `db` (Drizzle `PgDatabase`) | node-postgres pool | in-memory PGlite | PGlite + IndexedDB |
| `passwordHasher` | argon2id (`@node-rs/argon2`) | fast fake (`testing/`) | PBKDF2 via Web Crypto (`$demo-pbkdf2$`, refused by the server) |
| `fileStore` | local disk | in-memory | `demo_files` table in the visitor's PGlite |
| `clock` | `systemClock` | `fixedClock(...)` | system time shifted onto 31 Oct 2026 (the seed's "today") |
| `ids` | UUIDv7 via Web Crypto | same, fixed clock | same |
| `logger` | JSON lines to stdout | in-memory capture | console |

Enforced by `packages/core/tsconfig.json` (`lib: DOM + ES2023`, `types: []`, no `@types/node`) and `src/runtime-agnostic.test.ts` (fails on any Node built-in or Node-only package import under `src/`). `packages/core/testing/` is Node-only and lives outside `src/` on purpose.

Migrations: drizzle-kit writes SQL to `packages/core/drizzle/`. The server and tests apply them with Drizzle's filesystem migrator. The demo bundles the same SQL and journal (`packages/demo/src/bundled-migrations.ts`, `import.meta.glob(…, { query: "?raw" })`) and calls the same dialect migrator; a test proves the bundle reads exactly like the filesystem migrator.

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

## Tenancy, RBAC and audit

All of it lives in `packages/core`, never in the frontend (hiding UI is cosmetic).

- **Authentication** (`auth/sessions.ts`): `authenticate()` runs on `/api/v1/*` and resolves the `__Host-crowhr_session` cookie (or `crowhr_session` over plain http) or a native `Authorization: Bearer` token into `c.var.auth`. Expired or revoked credentials leave `auth` null and set `authFailure`, so `requireAuth` answers `session_expired` / `session_revoked`. CSRF (`auth/csrf.ts`) rejects cross-origin state changes for cookie requests.
- **Guards** (`auth/guards.ts`) run for every route after authentication: the MFA-enrolment gate (privileged roles past their 7-day grace) and `recentAuth` (10-minute re-auth).
- **RBAC** (`access/`): the matrix is data in `access/matrix.ts`; `authorize(c, permission)` returns a `Grant` (scopes `all`/`team`/`own`/`assigned`), 403 when no role grants it. Per-record narrowing uses the grant and answers 404, so out-of-scope records are indistinguishable from missing ones. Manager scope comes from the injected `ReportingScopeResolver` (people module implements it; `createStaticReportingScope` is the test double).
- **Tenancy** (`access/org-scope.ts`): every tenant table has `org_id` (a schema test fails otherwise), references between tenant tables are composite FKs `(org_id, id)`, and queries go through `orgScope(db, auth)`.
- **Audit** (`audit/audit.ts`): `recordAudit(tx, deps, auditContext(c), event)` appends to a per-org SHA-256 hash chain inside your transaction; the database rejects UPDATE/DELETE; `verifyChain` finds the first broken link.

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

### Data access, scope and audit in a handler

```ts
import { orgScope } from "../access/org-scope.ts";
import { auditContext, diffFields, recordAudit } from "../audit/audit.ts";
import { redact, withRedactions } from "../access/redact.ts";
import { sensitive } from "../access/sensitivity.ts";
import { assertNotSelfChange } from "../access/self-change.ts";

// Read one record: org filter first, then the caller's scope (404 when out of scope).
const org = orgScope(deps.db, auth);
const row = await org.getById(employees, params.id, "employee"); // 404 for other orgs
await grant.assertEmployee(row.id);                               // 404 outside team/own scope
return redact(c, employeeOut, toApi(row), { employeeId: row.id }); // drops salary/nric/bank/medical fields

// List: never load out-of-scope rows.
const rows = await deps.db.select().from(leaveRequests)
  .where(org.where(leaveRequests, await grant.employeeFilter(leaveRequests.employeeId)));

// Write + audit in one transaction (sensitive fields record names only).
assertNotSelfChange(c, params.id, "compensation");                // 403 self_change_requires_approval
await deps.db.transaction(async (tx) => {
  await tx.update(compensation).set(next).where(org.whereId(compensation, id));
  await recordAudit(tx, deps, auditContext(c), {
    action: "compensation.updated", targetType: "employee", targetId: params.id,
    diff: diffFields(before, next, { sensitive: ["amountCents"] }),
  });
});
```

Response schemas mark sensitive fields with `sensitive(z.number().optional(), "salary")` (always optional, since `redact` may drop them) and wrap the object in `withRedactions(...)`. NRIC/FIN and bank numbers are stored encrypted (`deps.secretBox.encrypt(SECRET_PURPOSES.nric, value)`) with a blind index (`secretBox.blindIndex("nric", normaliseNric(value))`), returned masked (`maskNric`), and revealed only through `revealSensitive(c, …)` from a dedicated `POST …/reveal` route.

### Tests every module adds

- **Cross-org**: nothing to register. `access/cross-org.test.ts` sweeps every non-public v1 route with a path parameter and calls it with org B's IDs as org A's owner, expecting 404. Seed at least one row of each of your tables for org B in that test (one `insert` per table), and give mutating routes an `example: { body }` that passes validation. A route without a record ID in its params may set `crossOrgExempt: "<reason>"`.
- **Permission matrix**: adding a key to `MATRIX` adds it to `access/matrix.http.test.ts` automatically (one stub route per row, every role, in and out of scope). Changing a cell is a spec change.
- Use `seedOrg`, `seedMember({ roles, employeeId })`, `clientAs(app, deps, member)` (a signed-in cookie client) and `movableClock` from `@crowhr/core/testing`.

Rules of the road:

- **`access`** is required: `"public"`, `"authenticated"` (any member; the handler limits itself to the caller's own data) or `{ permission }`. Permissions come from the matrix in `access/matrix.ts`; to add a row, add a key there with the cells from the access-control spec. The handler receives `grant` and must narrow per record: `await grant.assertEmployee(row.employeeId)` (404 when out of scope) or `where(and(orgFilter, await grant.employeeFilter(table.employeeId)))` for lists.
- **Sensitive actions** set `recentAuth: true` (password, MFA, email, security settings, SSO, role grants, NRIC/bank reveal, sensitive exports).
- **Responses** declare every status the handler can produce. The lowest 2xx is the default; return `reply(202, body)` for another declared status, `undefined` for a declared `204: null`, or a `Response` for a raw response (redirect, CSV) declared as `{ description, contentType? }`.
- **Errors** are `AppError(code, message)` with a message that says how to fix the problem. List extra codes in `errors`.
- **Sensitive fields** in response schemas are wrapped in `sensitive(schema, "salary" | "nric" | "bank" | "medical")`.
- **Lists** follow docs/api.md "Lists" via `listQuery` / `pageOf`.
- **Services, not routes**, hold logic and queries, so the same rules apply to every entry point (HTTP, jobs, CLI).

### Approvals: register a request type

A module whose records need approval (leave, claims, OT, payroll, …) implements a `SubjectAdapter` (`packages/core/src/workflows/types.ts`) and adds a `WorkflowPlugin` to `CORE_WORKFLOW_PLUGINS` in `workflows/registry.ts` (one line, like `V1_MODULES`). Submit inside the transaction that creates the record; the engine calls back in the transaction of the final decision, so a throwing callback rolls the decision back:

```ts
export const leaveWorkflowPlugin: WorkflowPlugin = {
  name: "leave",
  subjects: [{
    type: "leave", label: "Leave", inlineDecision: true,
    attributes: z.object({ typeCode: z.string() }),           // validated at submission
    summary: async (db, ref) => ({ title: "Annual leave, 4–6 Nov", lines: [...], context: [...] }), // no money in title
    onApproved: async (db, ref, decision) => { /* deduct balance; throw AppError to refuse */ },
    onRejected: async (db, ref, decision) => { ... },
    onWithdrawn: async (db, ref) => { ... },
  }],
};
await deps.db.transaction(async (tx) => {
  await tx.insert(leaveRequests).values(row);
  await submitApproval(tx, deps, auditContext(c), { orgId, subjectType: "leave", subjectId: row.id,
    requesterMembershipId: auth.membershipId, requesterEmployeeId: auth.employeeId, attributes: { typeCode: "annual" } });
});
```

Home items come from `InboxSource`s and reminders from `ReminderSource`s on the same plugin. Background work goes through `tick(deps, now)` (`jobs/tick.ts`): claim rows with `FOR UPDATE SKIP LOCKED` or de-duplicate with a unique key so two replicas never double-process; never use timers in core.

## Conventions for module authors

- **Schema**: one file per area in `packages/core/src/db/schema/`, re-exported from `index.ts`; snake_case column names; `uuid` primary keys generated by `deps.ids`; `timestamp with time zone`; money as integer cents in `bigint("…", { mode: "number" })` columns (never `numeric`/`real`, never floats). Then `bun run db:generate` and commit `drizzle/`. CI fails if the schema and migrations disagree.
- **Tests**: `createTestDb()` + `createTestDeps(db)` from `@crowhr/core/testing`; call `createApp(deps).request(...)`. Pass stub modules with `createApp(deps, { modules: [...] })`. One fresh PGlite per test file or test; close it in `afterEach`.
- **Web route**: `apps/web/src/routes/_app/<module>.tsx` (inside the shell) using `PageHeader` and `@crowhr/ui`. Add nav metadata in `src/shell/nav.ts`. Fixture data only in `src/fixtures/`, always with `<SampleDataNotice />`.
- **UI**: hairline borders by default; `Card variant="emphasis"`/`Button variant="primary"`/dialogs are the only hard-shadow surfaces. Numbers use the `num` class (Azeret Mono, tabular). Money via `formatMoney(cents)`, dates via `formatDate("YYYY-MM-DD")`, NRIC/FIN via `maskNric`.

## Effective-dated data

Records that change over time (employment terms, compensation, allowances, bank accounts, work schedule versions) use one convention, implemented in `packages/core/src/employees/effective.ts`:

- `effective_from date NOT NULL`, `effective_to date NULL`, half-open `[from, to)`; `null` means "until further notice".
- Write through `planInsert`: a new version closes the one in force on its start date and, if later versions already exist (future-dated changes), ends where the next one begins, in the same transaction. Two versions may not start on the same date.
- Non-overlap is enforced in the service (PGlite cannot guarantee `btree_gist` exclusion constraints) and covered by a property test.
- Read with `asAt(db, table, orgId, employeeId, date)` / `asAtMany(...)` or the `inForceOn(columns, date)` SQL fragment. Status such as "Scheduled" or "Leaving on X" is derived from dates and the injected clock (Asia/Singapore), never stored.

## The public demo (packages/demo, apps/demo)

```
page (apps/demo boot script + apps/web, unchanged)          Web Worker (packages/demo/src/worker.ts)
  fetch('/api/…') ── patched ─┐                               PGlite on IndexedDB (idb://crowhr-demo-<version>)
  <img src="/api/…">, links ──┼─ /demo-sw.js ─► page ─► RPC ─► bridge.ts: cookie jar ─► createApp(deps) (core)
  banner, outbox, reset ──────┘                               build snapshot on first open; real seed fallback
```

- **One runtime, one tab.** The worker owns the visitor's database and the real `createApp` with browser deps (`packages/demo/src/deps.ts`). The page holds a Web Lock so only one tab opens the database.
- **Transport.** The page's `fetch` is patched for same-origin `/api/*` only (`client.ts`); the service worker forwards requests a page cannot patch (images, downloads, new tabs) to an open demo tab. Requests and responses cross `postMessage` as plain data with transferred bodies (`protocol.ts`).
- **Cookies.** `bridge.ts` mounts core behind a tiny Hono wrapper that captures `Set-Cookie` at `c.header`, keeps a cookie jar in the worker and replays it on the next request (shadowing the Request's headers with an unguarded `Headers`, since browsers drop a script-set `Cookie`). Core runs its normal cookie sessions and CSRF checks.
- **Seed.** `packages/demo/src/seed/`: core's shared `seedPeople` plus three more people, then July–October 2026 through the public API as the person who would act (payroll admin prepares, owner approves, employees claim and apply for leave), with a clock that walks through the history. Payroll numbers come from the real engine.
- **Versioning and reset.** The IndexedDB name carries a data version (`SEED_VERSION` + a hash of demo sources and migrations): a deploy with a new seed or migration starts every visitor fresh and deletes old copies. Reset closes PGlite, deletes the database and restores the snapshot (or seeds on failure). Snapshot metadata is re-anchored to the visitor's Singapore time of day once, never to the build machine's date.
- **Files.** The demo file adapter caches fictional attachments in memory and writes them to `demo_files` after requests commit. Generated letters can therefore write from inside core transactions without making a root PGlite query that would deadlock. The bridge flushes files before its durability hook, and the seed flushes before snapshotting.
- **Build.** `apps/demo/scripts/build-snapshot.ts` runs the same migrations and real seed and emits `dist/assets/demo-<data-version>.tar.gz` using PGlite `dumpDataDir("gzip")`; the worker loads it with `loadDataDir`. No snapshot is committed or generated at runtime for other visitors. `apps/demo` builds apps/web's entry behind the boot script. A Vite plugin fails the build if server-only code (argon2, node-postgres, nodemailer, apps/server, core's Node test harness, Node built-ins outside PGlite) enters the bundle; PGlite's binaries ship gzip-compressed and are decompressed in the worker.
