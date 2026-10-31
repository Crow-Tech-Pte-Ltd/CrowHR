## Why

Crow HR has an agreed stack (AGENTS.md) but no code. Domain workstreams (employees, payroll, leave, claims, auth) need a shared, tested foundation to build on so they do not each invent their own app wiring, error format, test database, UI kit or shell. Without it they would diverge immediately.

## What Changes

- Bun workspace with Biome, strict TypeScript, Vitest, Playwright, root `check`/`test`/`e2e`/`build`/`dev` scripts, MIT LICENSE, `.env.example`.
- `packages/core`: runtime-agnostic Hono app factory `createApp(deps)` with injected database, password hasher, file store, clock, ID generator and logger. Ships `GET /api/health`, a typed JSON error envelope, a zod validation helper and the request context type that will carry `{ user, orgId, roles }`. Drizzle schema with `organisations` and `users`, drizzle-kit config, first migration, and a PGlite test harness.
- `packages/sg-rules`: package skeleton with a placeholder `CountryRules` interface (no statutory numbers).
- `packages/ui`: Crow Tech tokens and components ported from `crow-tech-landing`, plus the app primitives the landing site lacks (dialog, menus, select, tabs, tooltip, toasts, table + data table, command palette, sheet, skeleton, empty state, status pill, form field, date picker, money input, avatar, pagination). Fonts self-hosted.
- `apps/server`: Node entry with node-postgres, argon2id, local-disk file storage, env validation, serving `/api/*` and the built web app with SPA fallback.
- `apps/web`: application shell (sidebar, top bar, ⌘K palette, user menu, mobile drawer / bottom tab bar), a Home "work to do" inbox on clearly labelled fixture data, an empty state per module, a sign-in screen that renders the organisation's enabled methods (email + password, Google, Microsoft, Singpass, generic OIDC) but is not wired to anything, and a Settings → Security → Sign-in methods placeholder.
- GitHub Actions CI (lint, typecheck, unit/integration, build, dependency audit, Playwright smoke against a Postgres service).
- `docs/architecture.md` and `docs/limitations.md`.

## Capabilities

### New Capabilities
- `platform-foundation`: health endpoint, error envelope, input validation behaviour, runtime-agnostic core, database migration path, server configuration and static hosting, and the application shell's navigation, empty states and accessibility baseline.

### Modified Capabilities
None.

## Non-goals

- Authentication, sessions, memberships, OIDC flows (Google, Microsoft, Singpass, generic) and RBAC rules (auth workstream). The sign-in page, sign-in-method settings and org switcher are visual placeholders only.
- Any domain module (employees, payroll, leave, attendance, claims, documents, reports).
- Statutory rules or numbers in `sg-rules`.
- The in-browser demo (`apps/demo`, `packages/demo`), docs site and `docker-compose.yml`.
- Dark mode.

## Impact

- New code in `apps/web`, `apps/server`, `packages/core`, `packages/ui`, `packages/sg-rules`, `.github/workflows`, `docs/`.
- New dependencies: Hono, Drizzle ORM/kit, PGlite, node-postgres, @node-rs/argon2, zod, React 19, TanStack Router/Query/Table, Radix UI, cmdk, sonner, react-day-picker, Tailwind 3.4, Biome, Vitest, Playwright.
- Establishes conventions every later change follows (module routes, schema layout, test harness, UI primitives).
