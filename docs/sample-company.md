# The sample company on a real server

`scripts/seed-sample-company.ts` adds Kopi Kaki Pte. Ltd., the public demo's fictional café group
(short name `kopi-kaki`), to a running Crow HR server as an extra organisation, for app store
reviewers and sales demos. The server's other organisations are never read or written.

## What's in it

The demo's people and history, brought up to the real date: the latest payroll approved, released and
paid; rosters for the next nine weeks; last week's clock-ins; pending leave and claims for the
managers; every account with its own random password, no required two-step verification, no single
sign-on and no email (addresses are `@kopikaki.example`).

| Account | Sees and can do |
| --- | --- |
| Employee (Hafiz, barista) | Released payslips (PDF), leave balances and history, a pending leave request, claims (one pending with a receipt), the roster, clock in and out from anywhere (no location or office-network check) |
| Manager (Siti, his outlet supervisor) | An approvals inbox with pending claims and leave from her team; whatever Hafiz files next appears there too |

Hafiz reports to Siti throughout (the demo's Employee persona, Jun Jie, changes manager on 1 Dec 2026),
so he is the employee to give reviewers.

## Connecting the apps

With more than one organisation on the server, the apps ask for the organisation: type the server
address, tap Continue, enter `kopi-kaki` as the Organisation ID, then Connect and sign in on the page
that opens. The link `crowhr://connect?server=<address>&org=kopi-kaki` and its QR code (web app:
My profile → Mobile app) do the same. The apps don't read an organisation from a pasted sign-in URL.

## Checking it

`scripts/verify-sample-company.ts` does what the apps do over HTTPS: discovery, the native sign-in
(PKCE through `/api/v1/native/authorize`, the sign-in API and the token exchange) and the bearer API
for both accounts. It prints only results, never passwords:

```sh
# With SERVER, ORG, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD, MANAGER_EMAIL and MANAGER_PASSWORD in the
# environment (injected from your secrets store, never typed into the shell history):
node scripts/verify-sample-company.ts [--exercise]
# or with the seed script's credentials file:
node scripts/verify-sample-company.ts --credentials <file> [--exercise]
```

`--exercise` also applies for a day of leave about six weeks ahead, clocks in and out, has the
manager approve that leave, then cancels it again (balance unchanged). The seeded pending requests
are never touched. Run it before each submission.

Keep in mind:
- Rosters are published nine weeks ahead of the seeding day. Before they run out, sign in as HR
  (Aisyah, in the credentials file) and copy and publish further weeks in Schedules, or reviewers see
  an empty schedule.
- The history stops at the seeding day; nothing is added automatically afterwards. Hafiz has a few
  days of annual leave left, so reviewers should apply for a day or two.
- If reviewers approve all pending requests, sign in as Hafiz (or Maria) and file new ones.

## Creating it on a server

`scripts/seed-sample-company.ts` adds the company to any Crow HR server, with the server's own
configuration, database, argon2id hasher, encryption key and file storage. It seeds the history in
an in-memory scratch database (the demo's own seed, through the real services and API as each
person), brings it up to the real date (the latest payroll approved, released and paid; rosters for
the next nine weeks; last week's clock-ins; fresh requests for the manager; settings above; a new
password for every account through the change-password API; one scheduled sweep at the real time),
checks it, and only then copies the organisation into the server's database in **one transaction**
(`packages/demo/src/sample-company/`). It refuses, changing nothing, when an organisation
`kopi-kaki` or one of its email addresses exists, the schema or encryption key doesn't match, or
the credentials file exists. Other organisations are never read or written; the scheduled sweeps,
which are install-wide, run only in the scratch database.

Run it in a one-off container of the Dockerfile's `build` stage, built from the **same version as
the server**, with the app's environment and volumes, as the app's user:

```sh
docker build --target build -t crowhr:sample-seed .     # from a copy of the server's checkout
docker compose exec app crowhr backup                   # first
docker run --rm --user 10001:10001 --network <project>_default --env-file .env \
  -e DATABASE_HOST=db -e DATABASE_USER=crowhr -e DATABASE_NAME=crowhr \
  -e DATABASE_PASSWORD_FILE=/run/crowhr-secrets/db_password -e DATA_DIR=/data -e NODE_ENV=production \
  -v <project>_data:/data -v <project>_secrets:/run/crowhr-secrets:ro -w /src crowhr:sample-seed \
  node scripts/seed-sample-company.ts --credentials /data/.sample-company-credentials.json   # or --dry-run
```

The credentials file (mode 600, JSON) is the only place the passwords are written. Copy it into
your secrets store, then delete it from the volume.

**Removing** the organisation means restoring the backup taken before seeding (`crowhr restore`):
audit events are immutable, so there is no in-place delete.

Tests: `packages/demo/src/sample-company/sample-company.test.ts` (scratch seed, copy into a
database that already hosts another organisation, which must stay identical row for row; refusal
when run twice or when an email is taken; password sign-in, payslip PDF and the manager's inbox on
the copied data).
