# Contributing to Crow HR

Thanks for helping. Crow HR is MIT-licensed HR and payroll for Singapore SMEs, and contributions of code, documentation, bug reports and verification of statutory rules are all welcome.

## Before you start

- **Bugs and small improvements**: open an issue or a pull request directly.
- **Larger changes** (a new module, a change to the permission matrix, the API contract or a statutory rule): open an issue first. Substantial work starts as an OpenSpec change in `openspec/changes/<name>/` (proposal, design, spec deltas, tasks), so requirements are agreed before code is written.
- **Security issues**: do not open a public issue. See [SECURITY.md](SECURITY.md).

## Set up

You need [bun](https://bun.sh) 1.3 and Node 24. No Docker or PostgreSQL is needed for development or tests.

```sh
bun install
bun run dev        # API on 127.0.0.1:8080 with PGlite in ./data, web app via Vite
bun run docs:dev   # documentation site on http://localhost:4321/docs/
```

## Checks

```sh
bun run check
```

must pass before a pull request is merged: Biome, the third-party licence check, TypeScript, all Vitest suites, sg-rules coverage (≥ 95% lines), the OpenAPI snapshot check and the docs build with its link check. Also:

- Changed routes: `bun run openapi:generate` and commit `packages/core/openapi/v1.snapshot.json`.
- Changed the database schema: `bun run db:generate` and commit `packages/core/drizzle/`.
- Added or upgraded a dependency: `bun run licences` and commit `THIRD-PARTY-NOTICES.md`. Shipped dependencies must use a permissive licence; GPL-family and unknown licences are refused.
- Changed environment variables or CLI commands: update the configuration or CLI page in `apps/docs` (a test fails otherwise).

## Ground rules

These come from [AGENTS.md](AGENTS.md), which has the full working agreement:

1. **Test first** for calculations, permissions and workflows.
2. **Statutory numbers come from cited sources**: every CPF, SDL, FWL, leave or overtime constant in `packages/sg-rules` has an effective date and a source URL.
3. **Money is integer cents**, never floats; rounding is explicit and named.
4. **Permissions are enforced on the server** in `packages/core`; hiding UI is cosmetic.
5. **Every tenant table has `org_id`** and cross-organisation access has a test proving it fails.
6. **Never present placeholder functionality as done.** Mark stubs `// NOT IMPLEMENTED:`, leave the task unticked and list it in `docs/limitations.md`. Docs describe only what works.
7. **Design language**: calm and precise. Hairline borders, Azeret Mono for headings and numbers, Ubuntu for text, the yellow accent for the one primary action; no gradients, blurred shadows or vanity statistics. Keyboard accessible, WCAG AA, works at 360 px.
8. **Use fictional data** in tests, fixtures and screenshots. Never commit real NRIC numbers, salaries or personal data.

## Pull requests

- Keep each pull request to one change, with tests.
- Describe what changed, how you tested it and any limitation it leaves (the template asks for these).
- Tick OpenSpec tasks only when their test passes.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

By contributing, you agree that your contributions are licensed under the [MIT licence](LICENSE).
