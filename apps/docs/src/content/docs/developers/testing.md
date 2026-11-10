---
title: Testing
description: How Crow HR is tested - Vitest on PGlite, the permission and cross-organisation sweeps, sg-rules coverage, OpenAPI checks, Playwright, the self-host script and the docs checks.
---

Calculations, permissions and workflows are written test first. A green build is not treated as evidence of correctness on its own: statutory numbers also need cited sources and the [verification record](/docs/payroll/verification/).

## Commands

Run from the repository root after `bun install`:

| Command | What it runs |
| --- | --- |
| `bun run check` | Everything below except e2e: Biome, the third-party licence check (`scripts/third-party-notices.ts`), TypeScript for every package, all Vitest suites, sg-rules coverage (≥ 95% lines), the OpenAPI snapshot check, and the docs build with its link check. |
| `bun run test` | Vitest across every package and app. |
| `bun run typecheck` | `tsc` for each package. |
| `bun run coverage:sg-rules` | sg-rules tests with the coverage threshold. |
| `bun run openapi:check` | Snapshot is current; v1 is additive-only against released snapshots. |
| `bun run docs:build` | Builds this site, then checks every internal link and anchor and that every API path has a page. |
| `bun run e2e` | Builds the web app and runs Playwright. |

## Unit and integration tests

- **Vitest** everywhere. Integration tests run the real Hono app against **PGlite**, an in-process PostgreSQL in WebAssembly, so no Docker is needed. Use `createTestDb()` and `createTestDeps(db)` from `@crowhr/core/testing`, call `createApp(deps).request(...)`, and close the database in `afterEach`.
- Response schemas run in **strict** mode in tests: an undeclared field fails the test.
- `access/matrix.http.test.ts` checks every cell of the permission matrix for every role, in and out of scope.
- `access/cross-org.test.ts` calls every route that takes a record ID with another organisation's IDs and expects 404.
- `packages/sg-rules` runs the official and derived test vectors, CPF's 16 AW-ceiling examples and the 15 calculator-confirmed cases.
- Payroll has golden files (the CPF EZPay file), byte-identical PDF and result-hash tests, a 12-person company month and a full-year run.

## End-to-end

- **Playwright** specs in `e2e/` run the built web app against the real server. People and payroll screens use dev-only seeded servers (`packages/core/testing/*-dev-server.ts`, bound to 127.0.0.1) with fictional staff. `e2e/seed.ts` creates four fictional organisations: the main one, one with every SSO preset (sign-in page), a fresh one with only its owner (setup checklist, claim types) and one for the single sign-on round trip, which runs against the in-process mock OpenID provider served on 127.0.0.1 by `e2e/mock-idp-server.ts` (test only; it signs in whoever the test names). The first-run wizard runs against a second, empty server.
- **`e2e/self-host.sh`** builds the image and follows the install page in a throwaway compose project: clean `up`, setup wizard, backup, `down -v`, restore, lost-data-volume recovery, and the Caddy, nginx and Traefik examples from the reverse-proxy page over TLS with test certificates. It removes only what it created.

## Docs checks

The docs site has its own tests (`apps/docs/tests/`), run by `bun run test`:

- every environment variable the server, CLI, Dockerfile and compose file read is documented in the [configuration reference](/docs/self-hosting/configuration/), and nothing documented there is unused;
- every `crowhr` CLI command is documented in the [CLI reference](/docs/self-hosting/cli/);
- every permission resource has a label on the [roles and permissions](/docs/roles-and-permissions/) page (the table itself is generated from the matrix);
- the OpenAPI helpers group and render every operation.

After `astro build`, `scripts/check-dist.ts` fails on any broken internal link or `#anchor`, and on any OpenAPI path without a section in the API reference.
