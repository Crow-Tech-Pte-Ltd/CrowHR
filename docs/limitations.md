# Known limitations

Everything listed here is stubbed, placeholder or missing. Nothing on this list
may be described as working. Remove an entry only in the change that fixes it.

## Authentication and access (auth workstream)

- **No authentication.** There is no session, login, logout or auth middleware. `c.var.auth` is always `null`; `requireAuth` therefore returns 401 for every protected route (fail-closed). `// NOT IMPLEMENTED` in `packages/core/src/context.ts`.
- **Sign-in page is design only.** `apps/web/src/sign-in/` renders the enabled methods from a fixture (`?methods=all|password|sso`). Submitting the form or pressing a provider button sends nothing and shows "not available yet".
- **No SSO.** Google Workspace, Microsoft Entra ID, Singpass and generic OIDC are buttons only. `AuthContext.authMethod` / `identity` are typed but never set.
- **Singpass button is not brand-compliant yet.** Singpass's [button design specification](https://docs.developer.singpass.gov.sg/docs/getting-started/singpass-button-design-specification) (effective 1 Sep 2026) requires the official Singpass logo inside the button. The logo is not published under a licence that allows redistribution in this MIT repository, so it is not bundled; the button renders the name as text. `ProviderButton` accepts `singpassLogoSrc` for a deployer-supplied official asset. Do not go live with Singpass without it.
- **Settings → Security → Sign-in methods** is an empty-state placeholder with no configuration.
- **No RBAC.** `Role` is a placeholder `string`; no permission checks exist.
- **No tenancy helpers yet.** There are no tenant tables, so the org-scoped data-access helpers and cross-org tests do not exist yet. `users` is a global identity table; org memberships arrive with auth.
- **Org switcher** shows one sample organisation; "Add organisation" is disabled.
- **Admin/employee view** is a client-side preview toggle (user menu or `?view=employee`), not role-based.
- **User menu** shows a sample user; "Sign out" just navigates to `/sign-in`.

## Screens

- **Home** shows fixture data (`apps/web/src/fixtures/`), labelled "Sample data" on screen. Approve/Decline/View all only show a "not connected" toast.
- **Command palette** "People" results are fixture names; selecting one shows a toast.
- **Every module** (People, Payroll, Leave, Attendance, Schedules, Claims, Documents, Reports) is an empty-state placeholder. Settings lists future sections as "Not available yet".
- **No dark mode.** The landing site's dark tokens were not ported.

## Platform

- **`packages/sg-rules`** is a skeleton with a placeholder `CountryRules` interface and no statutory rules.
- **Browser demo** (`apps/demo`, `packages/demo`) does not exist. Core's migrations are applied with Drizzle's filesystem migrator; the demo will need to bundle the SQL.
- **PGlite server mode** (`DATABASE_URL=pglite:…`) is for local development and e2e only: single process, no pooling, no backups.
- **No `docker-compose.yml`** yet.
- **Dependency audit**: `bun audit` reports one moderate, dev-only advisory (GHSA-67mh-4wv8-2f99, esbuild ≤ 0.24.2 dev server) via drizzle-kit's `@esbuild-kit` loader. It is never shipped or run as a server. CI fails on high/critical only.
- **CI has not run**: the workflow exists but nothing has been pushed.
