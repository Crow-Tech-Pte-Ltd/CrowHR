# Store review server (Kopi Kaki on hr-demo.crow.sg)

**Status: live since 10 Nov 2026** (Daniel approved the store submissions). App Store and Google
Play reviewers connect the Crow HR apps to **https://hr-demo.crow.sg**, organisation **`kopi-kaki`**:
the public demo's fictional café group Kopi Kaki Pte. Ltd., added as a second organisation next to
`crow-hr-staging` (the server's Singpass demo organisation, unchanged). It is the same server the
public demo's Singpass login uses (see [deploy-demo.md](deploy-demo.md)).

The passwords are kept only in the maintainers' secrets vault (entry `agents/crowhr/store-reviewer`
with `SERVER`, `ORG`, `CONNECT_LINK`, `EMPLOYEE_EMAIL`/`EMPLOYEE_PASSWORD` for Hafiz, a barista at
the Jurong Point outlet, `MANAGER_EMAIL`/`MANAGER_PASSWORD` for Siti, his outlet supervisor,
`OWNER_EMAIL`/`OWNER_PASSWORD` for Lim Kah Hui and `ACCOUNTS_JSON` with all 13 accounts) and in the
store consoles' review notes. Never put them in git, issues or chat.

## What reviewers find

| Account | Sees and can do |
| --- | --- |
| Employee (Hafiz) | Released payslips July to October 2026 (PDF), leave balances and history, a pending leave request, claims (one pending with a receipt), this week's roster and published weeks to mid-January 2027, clock in and out from anywhere (no location or office-network check) |
| Manager (Siti) | Approvals inbox with pending claims and leave from her team (Hafiz and Maria); whatever Hafiz files next appears there too |

Every account has its own random password (the demo's public `kopi-kaki-demo` does not work here),
no account must set up two-step verification, and the organisation has no single sign-on methods
(the demo's placeholder Google, Microsoft and Singpass buttons were removed). The server has no
SMTP, so nothing is ever emailed; addresses are `@kopikaki.example`.

Why Hafiz and not the demo's Employee persona (Jun Jie): Jun Jie has a scheduled transfer to Jurong
Point on 1 Dec 2026, so his requests go to Wei Ming before that date and to Siti after it. Hafiz
reports to Siti throughout.

## How a reviewer connects

The apps call `GET /api/v1/meta`; with two organisations on the server they need the organisation ID.

- **iOS:** type `hr-demo.crow.sg` as the server address and tap Continue. The app says the server
  hosts more than one organisation and shows an **Organisation ID** field: enter `kopi-kaki`, tap
  Continue, then Connect. Sign in on the web page that opens (iOS may first ask to continue).
- **Android:** the connect screen has **no organisation field** (only "Scan QR code" and the server
  address), so typing the address always stops at "This server hosts more than one organisation".
  The reviewer must use the connect link or its QR code: `crowhr://connect?server=https%3A%2F%2Fhr-demo.crow.sg&org=kopi-kaki`.
  The dependable route is the in-app **Scan QR code** pointed at a QR shown on another screen,
  for example in the web app: sign in at https://hr-demo.crow.sg/sign-in/kopi-kaki as the employee,
  open My profile → Mobile app. (Adding an organisation field to Android, as on iOS, would remove
  this step; that is a change to `apps/android`.)
- Neither app reads an organisation from a pasted URL (`…/sign-in/kopi-kaki` or `?org=` fail), and
  there is no https app link.

Suggested review note (fill the passwords in from the vault in App Store Connect / Play Console only):

> Crow HR connects to a company's own Crow HR server. For review we run a demo server with a
> fictional company. All data is fictional.
>
> 1. Connect: on iPhone, enter the server address `hr-demo.crow.sg`, tap Continue, enter the
>    organisation ID `kopi-kaki`, tap Continue and Connect. On Android, tap "Scan QR code" and scan
>    the QR code shown at https://hr-demo.crow.sg/sign-in/kopi-kaki → after signing in with the
>    employee account below → My profile → Mobile app (or open
>    `crowhr://connect?server=https%3A%2F%2Fhr-demo.crow.sg&org=kopi-kaki` on the device).
> 2. Tap Sign in and sign in on the page that opens.
>    Employee: `hafiz@kopikaki.example` / (password). Manager: `siti@kopikaki.example` / (password).
> 3. As the employee: payslips, leave balances and applying for leave, clock in/out, claims with a
>    receipt photo, and the work schedule. As the manager: Approvals has pending leave and claims
>    from the team; leave the employee applies for appears there too.

## Checking it

`scripts/verify-sample-company.ts` does what the apps do over HTTPS: discovery, the native sign-in
(PKCE through `/api/v1/native/authorize`, the sign-in API and the token exchange) and the bearer API
for both accounts. It prints only results, never passwords:

```sh
# With SERVER, ORG, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD, MANAGER_EMAIL and MANAGER_PASSWORD in the
# environment (injected from the vault, never typed into the shell history):
node scripts/verify-sample-company.ts [--exercise]
# or with the seed script's credentials file:
node scripts/verify-sample-company.ts --credentials <file> [--exercise]
```

`--exercise` also applies for a day of leave about six weeks ahead, clocks in and out, has the
manager approve that leave, then cancels it again (balance unchanged). The seeded pending requests
are never touched. Run it before each submission.

Keep in mind:
- Rosters are published to the week of 11 Jan 2027. Before then, as HR (Aisyah, `ACCOUNTS_JSON`)
  copy and publish further weeks in Schedules, or reviewers see an empty schedule.
- The history ends in early November 2026 (punches to 9 Nov); nothing is added automatically
  afterwards. Hafiz has about 4 days of annual leave left; reviewers should apply for a day or two.
- If reviewers approve all pending requests, sign in as Hafiz (or Maria) and file new ones.

## Creating it on a server

`scripts/seed-sample-company.ts` adds the company to any Crow HR server, with the server's own
configuration, database, argon2id hasher, encryption key and file storage. It seeds the history in
an in-memory scratch database (the demo's own seed, through the real services and API as each
person), brings it up to the real date (October payroll approved, released and paid; rosters for
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
the vault, then delete it from the volume.

**Removing** the organisation means restoring the backup taken before seeding (`crowhr restore`):
audit events are immutable, so there is no in-place delete. On hr-demo.crow.sg that backup was
taken on 10 Nov 2026, just before seeding, and is in the app's backups volume.

Tests: `packages/demo/src/sample-company/sample-company.test.ts` (scratch seed, copy into a
database that already hosts another organisation, which must stay identical row for row; refusal
when run twice or when an email is taken; password sign-in, payslip PDF and the manager's inbox on
the copied data).
