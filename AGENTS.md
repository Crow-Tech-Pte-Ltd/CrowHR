# Crow HR — agent working agreement

Crow HR is a free, MIT-licensed, self-hostable HR + payroll platform for Singapore SMEs, by Crow Tech Pte. Ltd.
QuickHR is the functional benchmark; we do not copy its UI, code, assets or branding.

## Hard rules

1. **Nothing goes live without explicit approval from Daniel**: no deploys (hr.crow.sg, servers), no DNS or Cloudflare changes, no store releases or submissions, no paid services. Pull requests are the exception: push a branch, open the PR, wait for green CI and squash-merge it yourself (standing approval, 10 Nov 2026). Merging doesn't deploy anything here.
2. **Never mark placeholder or mocked functionality as done.** If something is stubbed, say so in code (`// NOT IMPLEMENTED:`), in the OpenSpec task list, and in `docs/limitations.md`.
3. **Statutory numbers come from cited sources.** Every CPF/SDL/FWL/leave/overtime constant in `packages/sg-rules` carries an effective date and a source URL comment. No uncited magic numbers.
4. **Money is integer cents** (`number`, must stay a safe integer). Never floats for money. Rounding is explicit and named (e.g. `roundHalfUpToDollar`).
5. **Permissions are enforced server-side** in `packages/core`. Frontend hiding is cosmetic only.
6. **Every tenant table has `org_id`** and every query goes through the org-scoped data access helpers. Cross-org access must have a test proving it fails.
7. **Test first** for calculations, permissions and workflows. A green build is not evidence of correctness.
8. **Resources are tight**: disk ~20 GB free, RAM ~11 GB free, other workloads running. Use the shared bun cache, don't run parallel heavyweight builds, don't start long-lived dev servers you don't stop, don't pull large Docker images, never touch existing containers/volumes/processes you didn't create.
9. **Stay in your lane**: only edit the paths your task owns. If you need a change elsewhere, note it in your report instead.

## Stack (decided — change only via an OpenSpec proposal)

| Concern | Choice |
| --- | --- |
| Language | TypeScript (strict) everywhere |
| Package manager | bun workspaces (`bun install`); runtime for server/tests is Node 24 |
| Web app | `apps/web`: Vite + React 19 + TanStack Router + TanStack Query + Tailwind 3.4 |
| UI kit | `packages/ui`: Crow Tech component library (Radix + CVA, ported from `crow-tech-landing`) |
| API | `packages/core`: Hono app factory + services + RBAC + Drizzle schema. **Runtime-agnostic**: no Node-only imports; DB driver, password hasher, file storage, clock and ID generator are injected |
| Server | `apps/server`: Node entry, node-postgres driver, argon2id hasher, local-disk file storage, serves `/api/*` and the built web app |
| DB | PostgreSQL 17 via Drizzle ORM + drizzle-kit migrations. Tests use PGlite (in-process Postgres) — no Docker needed for tests |
| Statutory rules | `packages/sg-rules`: pure, zero-dependency, effective-dated rule tables + calculators (CPF, SDL, FWL, leave, OT). Country interface allows a future `my-rules` |
| Demo | `packages/demo` + `apps/demo`: the **same** web app + the **same** `core` Hono app running in the browser against PGlite (IndexedDB), seeded with fictional data. Static, deployable to Cloudflare Pages at hr.crow.sg. Per-visitor isolated, resettable |
| Docs | `apps/docs`: Astro Starlight (Pagefind search), served at hr.crow.sg/docs |
| Tests | Vitest (unit + integration on PGlite), Playwright (e2e) |
| Lint/format | Biome; `tsc --noEmit` per package |
| Self-host | `docker-compose.yml`: `crowhr` app container + `postgres:17-alpine` |

## Authentication (product requirement)

Per-organisation sign-in methods, configured by the org owner in Settings → Security:

- **Email + password** — always available out of the box (argon2id, rate limiting, reset by email, optional TOTP MFA). An owner may disable it for staff once SSO works, but owner break-glass password login always remains.
- **Google Workspace SSO** (OIDC) — optional restriction to allowed hosted domain(s).
- **Microsoft Entra ID SSO** (OIDC) — optional restriction to tenant ID.
- **Singpass login** (OIDC / FAPI 2.0: PKCE, private_key_jwt, DPoP as required by Singpass). Requires each company to onboard as a Singpass relying party — we ship the integration + setup guide, and the UI states clearly when it isn't configured. Never fake it as working.
- **Generic OIDC** (Okta, Keycloak, Authentik…) comes almost free from the same code — include it.

Rules: one OIDC implementation (`openid-client`, runtime-agnostic) with provider presets, not per-provider hand-rolled flows. Client secrets / private keys are encrypted at rest. SSO identities link to **pre-provisioned users** (invited by HR) by verified email or, for Singpass, by the stored Singpass UUID — no open self-signup by default (optional JIT provisioning limited to allowed domains, off by default). Sign-in page shows only the methods the org has enabled. All sign-in, link/unlink and config changes are audit-logged. In the public demo, SSO buttons are visible but explain they are disabled in demo mode.

## Self-hosting must be dead simple (product requirement)

The audience is an SME with one technical person, not a DevOps team.

- **Install = copy `.env.example` → `.env`, set `PUBLIC_URL`, run `docker compose up -d`.** Nothing else is required. Secrets (session key, encryption key) are generated on first boot into the data volume if not provided.
- **One app image** (multi-arch amd64 + arm64, published to GHCR by `.github/workflows/release.yml` on a version tag) + `postgres:17-alpine` in the compose file. No Redis, no queues, no extra services. Background jobs run in-process.
- **Bring your own reverse proxy**: the app serves plain HTTP on one port (default 8080) and works unchanged behind Caddy, nginx, Traefik, Cloudflare Tunnel, or none (LAN). Honour `X-Forwarded-*` only from `TRUSTED_PROXIES`. Ship copy-paste examples for Caddy, nginx, Traefik and Cloudflare Tunnel in docs; don't bundle a proxy.
- **Migrations run automatically on start** (with a lock); a failed migration stops startup with a clear message and doesn't corrupt data.
- **First-run setup wizard in the browser** creates the org + owner, guarded by a one-time setup code printed in the container logs.
- **Backups**: a built-in scheduled `pg_dump` to the backups volume plus `docker compose exec app crowhr backup|restore`. Upgrades: `docker compose pull && docker compose up -d`.
- SMTP is optional; everything works without email (invites show a copyable link).
- Errors at startup tell the user exactly which variable is wrong and how to fix it.

## Mobile apps

Native, open source, in this repo: `apps/ios` (SwiftUI) and `apps/android` (Kotlin + Jetpack Compose), built and tested with `scripts/ios-*.sh` (on a Mac over SSH) and `scripts/android-*.sh` (on Linux); see each app's README. Privacy and support pages: `crow.sg/apps/crow-hr/{privacy,support}`. Version 1.0.0 is on Google Play and on the App Store (iPhone and iPad). Version 1.1.0 (13 Nov 2026, with the mobile audit fixes): iOS build 6 is in App Review, and Android versionCode 3 is uploaded and in Google Play review for production at 100% rollout (managed publishing off, so approval publishes it; `apps/android/store/receipts/production-review-3.json`). Release records: `apps/*/store/`.

- The app connects **only to the company's own Crow HR server**: the user enters the server URL or scans a QR code from the web app. Crow Tech runs no backend for it.
- **Zero data collection**: no analytics, no crash-reporting SDKs, no third-party SDKs that phone home. Store privacy labels: "Data Not Collected".
- Sign-in uses whatever methods that server enables (password, Google, Microsoft, Singpass, OIDC) via the system browser (ASWebAuthenticationSession / Custom Tabs, PKCE). Biometric unlock for the stored session.
- Scope: employee self-service + manager approvals — payslips, leave, clock-in (offline-tolerant queue, server-validated), claims with camera receipts, schedule, approvals inbox.
- Consumes the same versioned REST API as the web app; the API must be documented (OpenAPI) and stable enough for mobile clients that lag server versions.
- No remote push: it would need a Crow-held APNs/FCM key and a relay that sees data. The apps use the in-app inbox, background refresh and local notifications; any relay would be a separate, opt-in decision.

## Layout

```
apps/web  apps/server  apps/demo  apps/docs
packages/core  packages/sg-rules  packages/ui  packages/demo
openspec/      # specs + change proposals (source of truth for requirements)
research/      # Singapore regulatory research and test vectors, with citations
docs/          # repo-level docs (architecture, limitations) — user docs live in apps/docs
```

## Commands (root)

`bun install` · `bun run check` (biome + typecheck + unit/integration tests + sg-rules ≥ 95% line coverage + OpenAPI snapshot) · `bun run test` · `bun run e2e` · `bun run build`

## OpenSpec

Requirements live in the changes under `openspec/changes/<name>/` (proposal, design, specs, tasks); none are archived yet. Substantial work starts as a new change there. Tick tasks in `tasks.md` as you complete them. Trivial fixes don't need a change.

## Design language (non-negotiable — avoid generic "AI dashboard" look)

Crow HR is a calm, precise work tool that is recognisably Crow Tech: restrained neo-brutalism.

- **Tokens** from crow-tech-landing: near-white `surface-*`, near-black ink `primary`, yellow `kuning-*` accent (brand chip / selected / primary CTA), blue `biru-*` for links + focus rings, orange `oren-*` very sparingly. Status uses `success`/`warning`/`danger` only.
- **Light and dark**: the same semantic tokens, swapped by `html.dark` (landing site's dark set: #141414 page, warm off-white ink, kuning kept for the primary action). Use tokens only, never hard-coded colours; text on a yellow fill (`kuning-200/300`) is `text-accent-foreground`, which stays dark in both themes; hard shadows use `--shadow`. Check new screens with axe in both themes. PDFs stay black on white.
- **Type**: Azeret Mono for headings, labels, nav, and **all numbers** (`tabular-nums`). Ubuntu for body text.
- **Edges**: hairline 1px ink-at-low-opacity borders by default. The signature 2px ink border + hard offset shadow is reserved for a few emphasised surfaces (primary button, the active payroll run, modal dialogs). No soft blurry shadows, no gradients, no glassmorphism, no purple, no emoji.
- **Content over chrome**: no vanity stat cards with fake trend arrows. Home screens show work to do (approvals waiting, payroll due, expiring work passes), not decoration.
- **Tables are first-class**: dense (36–40px rows), sticky headers, right-aligned mono numbers, keyboard navigable, sensible empty states.
- **Labels** come from `textStyle` in `@crowhr/ui`, four roles: `section` (h2 and card titles), `group` (fieldset legends, sub-sections), `field` (the label of a read-only value: body font, muted) and `column` (table headers, nav and menu group labels: the only uppercase text). No kicker over page titles; an ID (employee or claim number) follows the title in muted mono.
- **Empty states** say what is empty and what fills it, in a plain left-aligned sentence: no icon, no centred card, no copy of the page header's button. An empty table keeps its header and shows one `TableEmptyRow`.
- **Status chips** only where the status carries information: an exception, something waiting on someone, or a row unlike its neighbours. The normal state (active member, statutory leave type, paid run, a due date weeks away) is plain text or nothing, and a list filtered to one status doesn't repeat it. Sentence case, no dot.
- **Every screen has** loading, empty, error and success states; validation messages say how to fix the problem.
- **Keyboard + a11y**: visible focus rings, ⌘K command palette (find employee, jump to module), WCAG AA contrast, works at 360px width (employees get a bottom tab bar on mobile).
- **Singapore conventions**: `S$1,234.56`, dates `31 Oct 2026`, NRIC/FIN masked by default (`S****567D`), Singapore public holidays.
- Icons: lucide-react, 16px, consistent stroke.
