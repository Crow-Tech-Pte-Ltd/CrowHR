## Context

Empty repository with AGENTS.md fixing the stack (see proposal.md - Why). The core API must later run unchanged inside the browser demo against PGlite, so anything host-specific has to be injected. Local machines have no Docker and limited disk; tests must use PGlite.

## Goals / Non-Goals

**Goals:**
- One obvious way to add an API module, a table, a migration, a test and a screen.
- Same `createApp` code path in Node, Vitest and (later) the browser.
- A shell that already looks like a finished Crow Tech product so modules drop into it.

**Non-Goals:**
- Auth, RBAC rules, tenancy helpers beyond the context type (no tenant tables exist yet).
- Browser-side migration bundling (the demo workstream owns it; see Risks).

## Decisions

1. **TypeScript source is the artefact; no package builds.** Workspace packages export `./src/*.ts`. Node 24 runs the server with native type stripping, Vite and Vitest consume source directly. All relative imports carry `.ts` extensions and `erasableSyntaxOnly` forbids enums/namespaces/parameter properties so stripping is always valid. *Alternative:* tsup/tsc builds per package — more moving parts, stale-dist bugs.
2. **`createApp(deps)` returns a Hono app with `/api/*` only.** Hosts add static serving after it. A catch-all `app.all('/api/*')` returns the 404 envelope so the SPA fallback can never swallow API paths. *Alternative:* core owns static serving — impossible in the browser.
3. **Deps are small interfaces** (`Db`, `PasswordHasher`, `FileStore`, `Clock`, `IdGenerator`, `Logger`). `Db` is Drizzle's `PgDatabase<PgQueryResultHKT, Schema>`, the common supertype of the node-postgres and PGlite drivers. IDs are UUIDv7 via Web Crypto (sortable, index-friendly).
4. **Errors**: `AppError(code, message, details?)` with a code→status map; `onError` turns everything else into `internal` and logs it. Validation uses Hono's `validator` wrapped by `validate(target, zodSchema)` so `c.req.valid()` stays typed. *Alternative:* `@hono/zod-validator` — fine, but its error shape would need overriding anyway.
5. **Request context**: Hono `Variables` carry `deps`, `requestId` and `auth: AuthContext | null`. `AuthContext = { user, orgId, roles }`. Auth middleware is not implemented; `requireAuth(c)` therefore always yields 401 today, which is the correct fail-closed behaviour.
6. **Schema layout**: one file per area under `packages/core/src/db/schema/`, re-exported from `index.ts`; drizzle-kit generates SQL into `packages/core/drizzle/`. Users are global identities (a person may belong to several orgs); memberships with `org_id` arrive with auth.
7. **Test DB**: `createTestDb()` (in `packages/core/testing/`, Node-only, outside `src/`) creates an in-memory PGlite and runs Drizzle's PGlite migrator over `drizzle/`. ~100 ms per database, no Docker.
8. **Runtime-agnostic proof**: `packages/core/tsconfig.json` uses `lib: ["dom","es2023"]` with `types: []` (no `@types/node`), and a Vitest test scans `src/` imports against `node:module`'s `builtinModules`.
9. **Server DB driver**: `DATABASE_URL=postgres://…` uses node-postgres (production). `DATABASE_URL=pglite:memory` or `pglite:<dir>` is a dev/e2e convenience so local smoke tests need no Postgres server. Migrations run at startup unless `MIGRATE_ON_START=false`.
10. **UI kit**: tokens copied from `crow-tech-landing/app/globals.css` with three app adjustments: colours use `<alpha-value>`; `--border` is a hairline grey (ink at ~13%), not mid-grey; `muted-foreground` is `#666` (AA on white) instead of `#999`. Shadow `[box-shadow:4px_4px_0_0_ink]` exposed as `shadow-brutal`/`shadow-brutal-sm` utilities and used only on primary buttons, dialogs and the active payroll run. Tailwind preset exported from `@crowhr/ui/tailwind-preset`. Fonts from `@fontsource/azeret-mono` and `@fontsource/ubuntu`.
11. **TanStack Table v8**, react-day-picker v9, tailwind-merge v2: the newest majors of each (v9, v10, v3) either target Tailwind 4 or are rewrites with little ecosystem yet; v8/v9/v2 are stable and well understood.
12. **Web routing**: TanStack Router file-based (`apps/web/src/routes/`), `_app` layout route holds the shell; `/sign-in` sits outside it. Each module is `routes/_app/<module>.tsx`.
13. **Shell persona**: there is no auth, so the admin/employee view is a client-side preview toggle (user menu, or `?view=employee`) clearly marked as such. Real roles will drive it later.

14. **Sign-in methods are data, not code paths.** The sign-in page takes `SignInMethod[]` (password with `staffEnabled`, google with optional hosted domain, microsoft, singpass, oidc with display name) and renders only those; the auth workstream will serve this per organisation. `ProviderButton` (packages/ui) follows Google's and Microsoft's sign-in branding (neutral white button, provider mark) and the Singpass button design specification ("White with outline" variant, approved label "Log in with Singpass", accessible name "Sing-pass"). The official Singpass logo is not bundled (no redistribution licence); a `singpassLogoSrc` prop lets a deployer supply it.

## Risks / Trade-offs

- [Node type stripping rejects non-erasable syntax] → `erasableSyntaxOnly` in the base tsconfig catches it at typecheck.
- [Drizzle migrator reads the filesystem, so it cannot run in the browser] → demo workstream must bundle migrations (e.g. `import.meta.glob('?raw')`) and call the dialect migrator; noted in docs/architecture.md.
- [PGlite dev mode diverges from real Postgres] → CI e2e runs against a real `postgres:17-alpine` service.
- [Singpass button without the official logo is not spec-compliant] → text placeholder, task 6.9 left open, listed in docs/limitations.md.
- [Fixture data mistaken for real behaviour] → fixtures live in `apps/web/src/fixtures/`, every screen using them renders a "Sample data" notice, and docs/limitations.md lists them.

## Migration Plan

Greenfield; nothing to migrate. Rollback is reverting the commits.
