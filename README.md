# Crow HR

Free, MIT-licensed HR and payroll for Singapore SMEs that you host yourself. By [Crow Tech Pte. Ltd.](https://crow.sg)

People records, approvals and monthly payroll with CPF, SHG, SDL and an FWL estimate, itemised payslips, and the files you upload to CPF EZPay, your bank and myTax Portal. It runs as one container plus PostgreSQL on your own server, and sends nothing to Crow Tech.

![A Crow HR payroll run for a fictional company: blocking issues first, then totals, changes since last month and the employee table](apps/docs/src/assets/screens/payroll-run-overview.webp)

## Quick start

You need Docker with the Compose plugin.

```sh
git clone https://github.com/Crow-Tech-Pte-Ltd/crow-hr.git && cd crow-hr   # repository URL not confirmed yet
cp .env.example .env            # 1. copy the settings
$EDITOR .env                    # 2. set PUBLIC_URL, e.g. https://hr.example.sg
docker compose up -d            # 3. start
docker compose logs app | grep -A3 'SETUP CODE'   # then open PUBLIC_URL and finish setup
```

Images are not published to a registry yet, so the first start builds the image from the checkout.

## Documentation

The documentation site lives in [`apps/docs`](apps/docs) and will be published at **https://hr.crow.sg/docs** (not deployed yet). Build it locally:

```sh
bun install
bun run docs:build              # static site in apps/docs/dist
bun run docs:dev                # http://localhost:4321/docs/
```

Start with the install guide (`apps/docs/src/content/docs/self-hosting/install.md`) and the [limitations](docs/limitations.md).

## Status

Early and under active development; not yet used for a real company's payroll.

| Built | Not built yet |
| --- | --- |
| Self-hosting (compose, setup wizard, migrations, encrypted backups, `crowhr` CLI) | Leave |
| Sign-in: password + TOTP, Google Workspace, Microsoft Entra ID, generic OIDC; Singpass implemented but not tested against real Singpass | Attendance and overtime capture |
| Members, roles, server-enforced permission matrix, tamper-evident audit log | Claims |
| Company, structure, employees, CSV import, lifecycle, work passes, change requests | Scheduling, documents, reporting |
| Approvals, notifications, Home work-to-do list | Public demo, mobile apps |
| Payroll: CPF/SHG/SDL/FWL estimate, payslips, CPF EZPay file, ISO 20022 bank file, IR8A export | Direct submission to CPF, IRAS or banks |

The statutory engine (`packages/sg-rules`) carries cited, effective-dated rules and is checked against CPF's published examples and its online calculator ([verification record](packages/sg-rules/VERIFICATION.md)). Crow HR is not approved or endorsed by CPF Board, IRAS or MOM, and it is not legal or tax advice: check results before you pay or file. Known gaps are listed in [docs/limitations.md](docs/limitations.md).

## Development

```sh
bun install
bun run dev                     # API on 127.0.0.1:8080 (PGlite), web app via Vite
bun run check                   # lint, typecheck, tests, sg-rules coverage, OpenAPI check, docs build
```

TypeScript throughout: Hono + Drizzle core, React web app, Astro Starlight docs. See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md) and [docs/architecture.md](docs/architecture.md).

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE) © Crow Tech Pte. Ltd. and contributors.
