---
title: Contributing
description: How to set up a Crow HR development environment, the checks a change must pass, and how to propose larger changes.
---

Crow HR is MIT-licensed and open to contributions. The short version is `CONTRIBUTING.md` in the repository; this page adds detail.

## Set up

You need [bun](https://bun.sh) 1.3 and Node 24.

```sh
git clone https://github.com/Crow-Tech-Pte-Ltd/CrowHR.git
cd CrowHR
bun install
bun run dev        # API on 127.0.0.1:8080 (PGlite in ./data), web app with Vite
```

No PostgreSQL or Docker is needed for development or tests: the server falls back to PGlite, and tests use in-memory PGlite.

Docs: `bun run --cwd apps/docs dev` serves this site at `http://localhost:4321/docs/`.

## Before you open a pull request

```sh
bun run check
```

It must pass: Biome (format and lint), the third-party licence check, TypeScript, all tests, sg-rules coverage, the OpenAPI snapshot, and the docs build with its link check. If you changed routes, run `bun run openapi:generate` and commit the snapshot. If you changed the database schema, run `bun run db:generate` and commit `packages/core/drizzle/`. If you added or upgraded a dependency, run `bun run licences` and commit `THIRD-PARTY-NOTICES.md`: shipped dependencies must use a permissive licence.

## What we look for

- **A test first** for calculations, permissions and workflows.
- **Cited sources** for any statutory number: an effective date and a URL to CPF, MOM, IRAS or SSG. No uncited constants.
- **Integer cents** for money, explicit named rounding.
- **Server-side permissions** through the matrix; never rely on hiding UI.
- **Honest status**: if something is stubbed, say so in the code (`// NOT IMPLEMENTED:`), in the task list and in `docs/limitations.md`. Never document a feature that does not work.
- **The design language**: calm, dense, precise. Hairline borders, Azeret Mono for headings and numbers, Ubuntu for text, the kuning accent for the one primary action. No gradients, blurred shadows or decorative statistics.
- **Accessible screens**: keyboard navigation, visible focus, WCAG AA contrast, 360 px wide layouts.

## Larger changes

Anything beyond a bug fix or small improvement starts as an [OpenSpec change](/docs/developers/openspec/) so the requirements are agreed before code is written. Open an issue first to discuss it.

## Reporting bugs and security issues

- Bugs and feature requests: the repository's issue tracker, using the templates.
- Security vulnerabilities: **not** in a public issue. See [security](/docs/help/security/).

## Licence

By contributing you agree that your contribution is licensed under the MIT licence. Everyone taking part follows the project's Code of Conduct (Contributor Covenant).
