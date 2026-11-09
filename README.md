# Crow HR

Free, MIT-licensed HR and payroll for Singapore SMEs that you host yourself. By [Crow Tech Pte. Ltd.](https://crow.sg)

People records, leave, attendance and overtime, expense claims, shift rosters, documents and HR letters, approvals, reports and monthly payroll with CPF, SHG, SDL and an FWL estimate, itemised payslips, and the files you upload to CPF EZPay, your bank and myTax Portal. It runs as one container plus PostgreSQL on your own server, and sends nothing to Crow Tech.

![A Crow HR payroll run for a fictional company: blocking issues first, then totals, changes since last month and the employee table](apps/docs/src/assets/screens/payroll-run-overview.webp)

## Quick start

You need Docker with the Compose plugin.

```sh
git clone https://github.com/Crow-Tech-Pte-Ltd/CrowHR.git && cd CrowHR
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
| Self-hosting (compose, setup wizard, migrations, backups, encrypted once you set `BACKUP_PASSPHRASE` (strongly recommended), `crowhr` CLI) | Mobile apps |
| Sign-in: password + TOTP, Google Workspace, Microsoft Entra ID, generic OIDC; Singpass tested against Singpass staging, not production | Direct submission to CPF, IRAS or banks |
| Members, roles, server-enforced permission matrix, append-only audit log with hash chaining | Virus scanning of uploads (a hook only; no scanner ships) |
| Company, structure, employees, CSV import, lifecycle, work passes, change requests | |
| Approvals, notifications, Home work-to-do list | |
| Leave: statutory and Government-paid types, policies, calendar, part-timers in hours, Government-paid leave report, year end | |
| Attendance: clock in/out with an offline queue, optional location/IP checks, timesheets, overtime claims (Part 4, 72-hour warning) | |
| Claims: types and caps, receipts, foreign currency, reimbursement through payroll or outside it | |
| Scheduling: shift templates, weekly rosters, conflicts and hour warnings, publishing, swaps and open shifts | |
| Payroll: CPF/SHG/SDL/FWL estimate, inputs fed from leave, attendance, rosters and claims, payslips, CPF EZPay file, ISO 20022 bank file, IR8A export | |
| Documents, HR letters and KETs, acknowledgements; reports with CSV/XLSX export | |
| In-browser demo (built, not deployed yet) | |

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
