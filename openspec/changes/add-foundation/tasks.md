## 1. Workspace

- [x] 1.1 root: bun workspaces `package.json` (Node 24 engines, `check`/`test`/`e2e`/`build`/`dev` scripts), Biome config, strict `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `.env.example`, MIT `LICENSE` — verified by `bun install` and `bunx biome check .` passing
- [x] 1.2 root: Vitest projects config running every package's tests — verified by `bun run test` discovering all packages

## 2. sg-rules skeleton

- [x] 2.1 packages/sg-rules: package with placeholder `CountryRules` interface marked NOT IMPLEMENTED, vitest config — verified by `packages/sg-rules/src/index.test.ts`

## 3. Core

- [x] 3.1 packages/core: dependency interfaces (db, passwordHasher, fileStore, clock, ids, logger) and UUIDv7 id generator — verified by `src/ids.test.ts`
- [x] 3.2 packages/core: error envelope (`AppError`, onError, `/api/*` 404) and request-id middleware — verified by `src/app.test.ts` (404 envelope, internal error hides message, `x-request-id` header)
- [x] 3.3 packages/core: `validate(target, schema)` zod helper with field-path issues — verified by `src/http/validate.test.ts`
- [x] 3.4 packages/core: request context type carrying `{ user, orgId, roles }` and fail-closed `requireAuth` — verified by `src/app.test.ts` (401 envelope)
- [x] 3.5 packages/core: `GET /api/health` with database check (200 ok / 503 degraded) — verified by `src/routes/health.test.ts`
- [x] 3.6 packages/core: Drizzle schema `organisations` + `users`, drizzle-kit config, first migration in `drizzle/` — verified by `bun run --cwd packages/core db:check` and the PGlite test below
- [x] 3.7 packages/core: PGlite harness `createTestDb()` in `testing/` and integration test inserting/reading an organisation — verified by `testing/test-db.test.ts`
- [x] 3.8 packages/core: no Node-only imports in `src/` — verified by `src/runtime-agnostic.test.ts` and `tsconfig.json` with `types: []`
- [x] 3.9 packages/core: in-memory file store usable in any runtime — verified by `src/files/memory-file-store.test.ts`

## 4. UI kit

- [x] 4.1 packages/ui: tokens, Tailwind preset, self-hosted fonts (@fontsource), `cn` — verified by web build bundling the font files (no fonts.googleapis.com reference in `apps/web/dist`)
- [x] 4.2 packages/ui: ported landing components (button, badge, card, input, textarea, label, checkbox, switch, radio-group, alert, popover, calendar, alert-dialog) — verified by `bun run typecheck` and use in the shell
- [x] 4.3 packages/ui: app components (dialog, dropdown-menu, select, tabs, tooltip, toaster, table, data-table, command, sheet, skeleton, empty-state, status-pill, form-field, date-picker, money-input, avatar, pagination, kbd, separator) — verified by `bun run typecheck` and use in the shell
- [x] 4.4 packages/ui: SG formatting + money parsing (`formatMoney`, `parseMoneyToCents`, `formatDate`, `maskNric`) — verified by `src/lib/format.test.ts`

## 5. Server

- [x] 5.1 apps/server: zod env config with readable startup errors — verified by `src/config.test.ts`
- [x] 5.2 apps/server: node-postgres / PGlite db factory with migrate-on-start, argon2id hasher, local-disk file store with path traversal guard — verified by `src/argon2-hasher.test.ts` and `src/disk-file-store.test.ts`
- [x] 5.3 apps/server: serves `/api/*` from core and built web with SPA fallback — verified by `src/http.test.ts` (deep link → index.html, unknown API → JSON 404)

## 6. Web shell

- [x] 6.1 apps/web: Vite + React 19 + TanStack Router (file-based) + Query, Tailwind with ui preset — verified by `bun run build`
- [x] 6.2 apps/web: shell — grouped collapsible sidebar, top bar (org switcher placeholder, ⌘K palette, user menu), mobile drawer + employee bottom tab bar — verified by `e2e/smoke.spec.ts`
- [x] 6.3 apps/web: Home "work to do" inbox on labelled fixture data — verified by `e2e/smoke.spec.ts` (sample data notice visible)
- [x] 6.4 apps/web: module routes render honest empty states — verified by `e2e/smoke.spec.ts`
- [x] 6.5 apps/web: sign-in page design, form NOT IMPLEMENTED (submits nowhere, says so) — verified by `e2e/smoke.spec.ts` ("sign-in form sends nothing")
- [x] 6.6 apps/web + packages/ui: sign-in renders only enabled methods (password, Google, Microsoft, Singpass, generic OIDC) with provider-guideline buttons; owner break-glass link when staff password is off — verified by `e2e/smoke.spec.ts` ("renders only the enabled methods") and screenshots `sign-in-all.png` / `sign-in-password.png`
- [x] 6.7 apps/web: Settings → Security → Sign-in methods empty-state placeholder — verified by screenshot `sign-in-methods.png`
- [x] 6.8 packages/core: `AuthContext` carries `authMethod` and identity-provider info — verified by `bun run typecheck`
- [ ] 6.9 packages/ui: Singpass button uses the official Singpass logo (NOT DONE: logo not redistributable under MIT; text placeholder + `singpassLogoSrc` prop; see docs/limitations.md)

## 7. CI, e2e, docs

- [x] 7.1 root: Playwright config pinned to an installed Chromium build, smoke test — verified by `bun run e2e` locally
- [x] 7.2 .github/workflows/ci.yml: install (cached), biome, typecheck, vitest (4 shards), build, `bun audit`, Playwright smoke against Postgres 17 service — green on GitHub Actions, run 41329023066 (2 Nov 2026)
- [x] 7.3 docs: `docs/architecture.md`, `docs/limitations.md` — verified by review
- [x] 7.4 Design self-review screenshots (Home, empty module, sign-in, 390px Home) iterated — verified by screenshots in the session scratchpad
