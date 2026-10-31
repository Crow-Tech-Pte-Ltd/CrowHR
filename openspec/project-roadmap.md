# Crow HR roadmap

Planning view across OpenSpec changes. Requirements live in each change's `specs/`. This file covers order, dependencies and who owns which files. Updated 31 Oct 2026.

## Milestones

| Milestone | Outcome | Changes (status) |
| --- | --- | --- |
| **M1: run a real payroll** | An SME can install Crow HR, set up the company and people, have staff sign in, apply for and approve leave, and run, approve and release a monthly payroll with payslips. Home shows work to do. | `add-foundation` (in progress) · `add-api-platform` · `add-identity-and-access` (except Singpass) · `add-organisation-and-people` · `add-approvals-and-notifications` · `add-self-hosting` (M1 parts) · `add-sg-statutory-engine` (in progress, `packages/sg-rules`) · **payroll run + payslips in core** (to spec, on top of the statutory engine) · **leave** (to be specced after the regulatory research) |
| **M2: complete the monthly cycle** | Claims flow into payroll, attendance and OT feed payroll, the CPF EZPay file and the IR8A export exist, and reports export to Excel. | `add-claims` · **attendance + OT** (to spec) · `add-reporting` · **CPF EZPay file** (to spec) · **IR8A / myTax import export** (to spec) |
| **M3: shift work, paperwork, reach** | Rostering, documents and KETs, Singpass login, the public in-browser demo, the docs site, the landing page, and self-host polish. | `add-scheduling` · `add-documents` · `add-identity-and-access` §8 Singpass · **demo** (to spec) · **docs site** (to spec) · **landing** (to spec) · `add-self-hosting` (M3 parts: scheduled backups, System page, proxy docs, upgrade docs, multi-arch check) |
| **M4: mobile** | Native iOS and Android ESS and manager apps that connect to any company's own server, with zero data collection. | `add-mobile-apps` (planning only now) |

Nothing in any milestone is deployed, pushed publicly, or published to a store or registry without Daniel's explicit approval (AGENTS.md rule 1).

## Dependency graph

```
add-foundation
  └─ add-api-platform (route helper, /api/v1, OpenAPI) ── must land before module routes are written
       └─ add-identity-and-access (sessions, authorize, redact, audit, SecretBox)
            ├─ add-self-hosting (setup wizard uses identity services; secrets for SecretBox)
            └─ add-organisation-and-people (implements ReportingScopeResolver)
                 └─ add-approvals-and-notifications (manager resolution, tick, inbox)
                      ├─ leave ──────────────┐ (LeaveCalendar for scheduling; leave reports)
                      ├─ payroll ◄── add-sg-statutory-engine (sg-rules CPF/SDL/SHG/FWL/EA)
                      │    ├─ CPF EZPay file, IR8A export (M2)
                      │    └─ consumes claims ReimbursementSource (M2)
                      ├─ add-claims (M2)
                      ├─ attendance + OT (M2) ── consumes scheduling PlannedShifts when present
                      ├─ add-reporting (M2; contracts usable from M1)
                      ├─ add-scheduling (M3; needs leave)
                      └─ add-documents (M3; shares the PDF renderer with payslips)
add-mobile-apps (M4) ── needs add-api-platform + attendance idempotent punches + notifications cursor
```

Interfaces defined ahead of their implementers. Each comes with a test double, so work does not block:

| Interface | Defined in | Implemented by |
| --- | --- | --- |
| `ReportingScopeResolver` | identity-and-access | organisation-and-people |
| `SubjectAdapter` (approvals) | approvals-and-notifications | leave, claims, OT/timesheet, profile change, shift swap, payroll |
| `InboxSource`, `ReminderSource` | approvals-and-notifications | checklists, setup, work pass, probation, documents, payroll cutoff, backups |
| `ReimbursementSource` | claims | consumed by payroll |
| `LeaveCalendar` | scheduling | leave |
| `PlannedShifts` | scheduling | consumed by attendance |
| `ReportDefinition` + payroll-cost/leave row contracts | reporting | employees, claims, leave, attendance, payroll |
| `sg-rules` lookups (rest day, minimum age, notice, CSN payment types, Part IV thresholds, hour limits, KET items) | each consuming change, marked TODO | `add-sg-statutory-engine` covers Part IV and OT; minimum age and default notice landed (`employment-act/notice-and-age.ts`, MOM-cited); the rest are follow-ups for the sg-rules workstream |

## Workstreams and file ownership

Rule: a workstream edits only the paths it owns. To change another workstream's path, open a note or PR request to its owner (AGENTS.md rule 9). Paths are relative to the repo root. Core modules are directories under `packages/core/src/`. Web routes are under `apps/web/src/routes/_app/`.

| Workstream | Changes | Owns |
| --- | --- | --- |
| **WS0 Foundation / integrator** (lead) | add-foundation, add-api-platform | `packages/core/src/{app.ts,http/,openapi/,meta/}`, `packages/core/src/db/schema/index.ts`, `packages/core/drizzle/` (migration journal), `packages/ui/`, `apps/web` shell (`__root`, `_app.tsx`, nav config, `routeTree.gen.ts`), root config, CI |
| **WS1 Identity** | add-identity-and-access | core `auth/`, `access/`, `audit/`, `crypto/`; schema `auth.ts`, `access.ts`, `audit.ts`; web `routes/sign-in*`, `routes/invite*`, `routes/reset*`, `_app/settings/security*`, `_app/settings/members*`, `_app/settings/audit*`, `_app/me/sessions*` |
| **WS2 People** | add-organisation-and-people | core `organisation/`, `employees/` (including `employees/reports/`); schema `organisation.ts`, `employees.ts`; web `_app/people/*`, `_app/settings/company*`, `_app/settings/structure*`, `_app/me/profile*` |
| **WS3 Workflows** | add-approvals-and-notifications | core `workflows/`, `notifications/`, `jobs/`; schema `workflows.ts`, `notifications.ts`; web `_app/index.tsx` (Home), `_app/inbox*`, `_app/settings/approvals*`, `_app/settings/notifications*`; `apps/server/src/{mailer,scheduler}*` |
| **WS4 Payroll + statutory** | add-sg-statutory-engine, payroll run, CPF file, IR8A (to spec) | `packages/sg-rules/src/{cpf,sdl,shg,fwl,tax}/`; core `payroll/`, `pdf/` (first lander); web `_app/payroll/*` |
| **WS5 Time** | leave, attendance + OT (to spec), add-scheduling | `packages/sg-rules/src/{leave,ot,hours}/`; core `leave/`, `attendance/`, `scheduling/`; web `_app/leave/*`, `_app/attendance/*`, `_app/schedule/*` |
| **WS6 Money and paper** | add-claims, add-documents, add-reporting | core `claims/`, `documents/`, `reporting/`, `export/`, `files/`; web `_app/claims/*`, `_app/documents/*`, `_app/reports/*` |
| **WS7 Self-host** | add-self-hosting | `Dockerfile`, `docker-compose.yml`, the `.env.example` self-host section, `apps/server/src/{setup,backup,proxy,secrets,migrate,cli}/`, core `setup/`, `system/`, web `routes/setup*`, `_app/settings/system*`, `apps/docs` self-host pages |
| **WS8 Demo, docs, landing** | (to spec) | `packages/demo`, `apps/demo`, `apps/docs` (except self-host and API pages), landing |
| **WS9 Mobile** (M4) | add-mobile-apps | `apps/ios`, `apps/android`, `scripts/ios-*`, `scripts/android-*` |

### Parallel plan

- **M1 wave 1** runs in parallel with no file overlap: WS0 (api-platform route helper and v1 mount), WS1 (identity, against a `ReportingScopeResolver` double), WS2 (organisation and people, against a workflows double for change requests), WS4 (sg-rules CPF/SDL/SHG pure calculators, once research lands, with no core dependency), WS5 (sg-rules leave and holiday rules), WS7 (config, secrets, proxy, compose, migrations wrapper).
- **M1 wave 2:** WS3 (workflows, after WS1 + WS2 interfaces), WS4 core payroll (after WS2 compensation), WS5 core leave (after WS2 + WS3), WS7 setup wizard (after WS1).
- **M1 wave 3:** Home inbox integration (WS3), payslips + release (WS4), end-to-end payroll month (all).
- **M2:** WS6 claims and reporting in parallel with WS5 attendance and WS4 CPF/IR8A files.
- **M3:** WS5 scheduling, WS6 documents, WS1 Singpass, WS8 demo/docs/landing and WS7 polish all run in parallel.

### Merge hotspots and rules

1. **Drizzle migrations.** Generated SQL and `drizzle/meta/_journal.json` conflict whenever two branches add migrations. Never hand-merge the journal. Rebase onto main, delete your branch's generated migration, re-run `drizzle-kit generate`, re-run tests. Keep one migration per PR, and let the integrator (WS0) merge schema-changing PRs one at a time.
2. **`db/schema/index.ts`, `app.ts` module mounting, the web nav config and `routeTree.gen.ts`.** These are one-line additions owned by WS0. Workstreams may append their own line, but conflicts are resolved by WS0, and `routeTree.gen.ts` is regenerated, never merged by hand.
3. **Shared utilities** (`files/`, `pdf/`, `export/`, `org_counters`). The first lander creates them and owns them afterwards; for the others, see the table above. Later users extend them by request.
4. **`.env.example` and server config.** WS7 owns the self-host section. Other workstreams add variables through WS7.
5. **Cross-org and permission matrix tests** (`access/matrix.http.test.ts`, `testing/cross-org.ts`). WS1 owns them. Each module adds its rows by PR to WS1, or registers routes that the cross-org helper discovers automatically.

## Open items blocking specs

- `research/sg-regulatory.md` blocks the payroll, leave, attendance/OT, CPF file and IR8A changes, and the TODO-cited values in organisation and people (rest day, minimum age, default notice, CSN payment types), scheduling (hour limits) and documents (KET mandatory items).
- Demo, docs and landing changes are not yet written. The demo must provide the API for mobile store review if that route is chosen (see `add-mobile-apps` design).

## Lead decisions (2026-10-31)

- Research has landed (`research/sg-regulatory.md`, verified by `research/verification/codex-verification.md`); resolve TODO-cited values from it as each module is implemented.
- One legal entity and one CPF Submission Number per org in v1.
- PDF rendering lives in core `pdf/`, built first by WS4 for payslips and reused by documents. It must be runtime-agnostic (it runs in the browser demo too), so use a pure-JS renderer with self-hosted fonts.
- Roles are combinable: one person may hold `hr_admin` + `payroll_admin`, which is the usual SME setup. Keeping salary out of plain `hr_admin` is accepted.
- Backups include the encryption key by default. The backup command warns loudly and recommends the passphrase option.
- Mobile bundle/application id `crowtech.crowhr`. No remote push in v1 (in-app inbox, background refresh, local notifications). UnifiedPush and relay options are deferred to a later opt-in decision.
- Integrator (WS0) = lead agent. Workstreams after WS1 work on branches/worktrees; the lead merges and regenerates migrations per the merge-hotspot rules.
