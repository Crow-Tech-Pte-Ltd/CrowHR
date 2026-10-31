# Crow HR — agent working agreement

Crow HR is a free, MIT-licensed, self-hostable HR + payroll platform for Singapore SMEs, by Crow Tech Pte. Ltd.
QuickHR is the functional benchmark; we do not copy its UI, code, assets or branding.

## Hard rules

1. **Nothing public without explicit approval from Daniel**: no deploys, no DNS, no `git push` to public remotes, no making repos public, no paid services. Local dev only.
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

## Layout

```
apps/web  apps/server  apps/demo  apps/docs
packages/core  packages/sg-rules  packages/ui  packages/demo
openspec/      # specs + change proposals (source of truth for requirements)
research/      # competitive + regulatory research with citations
docs/          # repo-level docs (architecture, limitations) — user docs live in apps/docs
```

## Commands (root)

`bun install` · `bun run check` (biome + typecheck + unit/integration tests) · `bun run test` · `bun run e2e` · `bun run build`

## OpenSpec

Requirements live in `openspec/specs/`. Substantial work starts as a change in `openspec/changes/<name>/` (proposal, design, specs delta, tasks) and is archived when done. Tick tasks in `tasks.md` as you complete them. Trivial fixes don't need a change.

## Design language (non-negotiable — avoid generic "AI dashboard" look)

Crow HR is a calm, precise work tool that is recognisably Crow Tech: restrained neo-brutalism.

- **Tokens** from crow-tech-landing: near-white `surface-*`, near-black ink `primary`, yellow `kuning-*` accent (brand chip / selected / primary CTA), blue `biru-*` for links + focus rings, orange `oren-*` very sparingly. Status uses `success`/`warning`/`danger` only.
- **Type**: Azeret Mono for headings, labels, nav, and **all numbers** (`tabular-nums`). Ubuntu for body text.
- **Edges**: hairline 1px ink-at-low-opacity borders by default. The signature 2px ink border + hard offset shadow is reserved for a few emphasised surfaces (primary button, the active payroll run, modal dialogs). No soft blurry shadows, no gradients, no glassmorphism, no purple, no emoji.
- **Content over chrome**: no vanity stat cards with fake trend arrows. Home screens show work to do (approvals waiting, payroll due, expiring work passes), not decoration.
- **Tables are first-class**: dense (36–40px rows), sticky headers, right-aligned mono numbers, keyboard navigable, sensible empty states.
- **Every screen has** loading, empty, error and success states; validation messages say how to fix the problem.
- **Keyboard + a11y**: visible focus rings, ⌘K command palette (find employee, jump to module), WCAG AA contrast, works at 360px width (employees get a bottom tab bar on mobile).
- **Singapore conventions**: `S$1,234.56`, dates `31 Oct 2026`, NRIC/FIN masked by default (`S****567D`), Singapore public holidays.
- Icons: lucide-react, 16px, consistent stroke.
