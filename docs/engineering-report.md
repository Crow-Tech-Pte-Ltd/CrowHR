# Crow HR — engineering report

> A snapshot from 7 November 2026, before the 1.0.0 release, kept as a record. For the current state see [CHANGELOG.md](../CHANGELOG.md), [limitations](limitations.md) and the [project status](https://hr.crow.sg/docs/status/) page.

**Status as of 7 November 2026.** `main` is pushed to the private repository `Crow-Tech-Pte-Ltd/CrowHR` and CI is green. Nothing has been deployed, published or submitted to an app store.

## Summary

Crow HR is a working, self-hostable HR and payroll platform for Singapore SMEs, MIT-licensed and built from scratch in TypeScript. Every web module in the original brief is implemented, integrated and tested end to end. Statutory calculations are checked against CPF Board's own calculator and an independent second model. An independent security review found 25 defects, and every confirmed one is fixed and re-verified against the reviewer's own probes. Native iOS and Android apps (milestone M4) are built and tested against a real server; they are not yet in the app stores.

## What exists

| Area | Built |
|---|---|
| Identity & access | Email + password (argon2id), TOTP MFA and recovery codes, sessions and devices, invitations, Google Workspace / Microsoft Entra / generic OIDC SSO, Singpass (FAPI 2.0, tested against a mock only), five combinable roles with a server-enforced permission matrix, org isolation, immutable hash-chained audit log |
| Organisation & people | Company / CSN, structure, work schedules, employee records (NRIC encrypted and masked, residency/PR, SHG, work passes, bank), effective-dated compensation and allowances, lifecycle events, CSV import with YTD opening balances, change requests, preferred names, manager/executive flag |
| Approvals & notifications | One engine for every request type: chains, thresholds, delegation, escalation, conflict-of-interest exclusions; in-app inbox; optional SMTP; Home "work to do" |
| Payroll | Monthly and off-cycle runs (draft → review → approve → paid, adjustments), CPF / SDL / SHG / FWL estimate with a per-employee working trace, OW/AW and AW ceiling, pro-ration, OT, claims, leave encashment (gross rate), MOM-compliant payslips (PDF incl. Chinese/Tamil), CPF EZPay file, generic ISO 20022 bank file, IR8A import rows |
| Leave | All statutory types with eligibility predicates, policies, accrual, carry-forward and expiry, PH-in-lieu, part-timers, calendar, encashment, government-paid leave report |
| Attendance & OT | Offline-tolerant clock-in, timesheets, lateness, Part IV OT eligibility, 72h cap, OT claims feeding payroll |
| Scheduling | Shift templates, roster week grid, publishing, conflict and hour warnings, swaps / open shifts; rosters feed attendance, leave and payroll |
| Claims | Claim types and caps, receipts (sniffed uploads, optional ClamAV), foreign currency, approvals, reimbursement through payroll |
| Reports & documents | 10 reports (CSV/XLSX, permission-scoped, salary columns redacted), document storage, letter templates and KETs (all MOM items), acknowledgements |
| Self-hosting | One image (211 MB) + Postgres 17; `docker compose up -d`; generated secrets; any reverse proxy; auto-migrations with lock; setup wizard; `crowhr` CLI (backup / restore / doctor); encrypted scheduled backups |
| Docs | Starlight site (82 pages, searchable, API reference for 276 operations), checked against code by tests (env vars, CLI, permission matrix) |
| Demo | The real app + real API in the browser on PGlite, fictional café group, all modules seeded, ~1.2 s first load, per-visitor and resettable, Cloudflare Pages config ready |
| Mobile apps | `apps/ios` (SwiftUI) and `apps/android` (Kotlin + Compose): connect by QR or address, system-browser sign-in with PKCE, biometric unlock, payslips, leave, offline clock-in (monotonic elapsed time, so a changed phone clock can't move a punch), claims with camera receipts, schedule, approvals, background refresh with content-free local notifications. Zero data collection: no analytics, crash reporting or third-party SDKs; tests assert every connection goes to the company's server only |
| Landing page | `/apps/crow-hr` in crow-tech-landing on branch `crow-hr-product-page`, unlisted behind `CROW_HR_LAUNCHED = false`, noindex |

## Verification

- **Automated:** 2,227 core/integration tests + 419 statutory-engine tests (99.7% line coverage, ≥95% enforced), 52 Playwright end-to-end tests (also run in UTC), 3 demo end-to-end tests, docs build with link check; iOS 72 unit + 3 UI journey tests on a Mac simulator; Android 62 unit + 17 device tests on a 16 KB-page emulator. All green; GitHub Actions runs the web suite, Docker install and Android unit tests + lint on every push.
- **Statutory correctness:** 91 researched test vectors; 15/15 cases match CPF Board's online calculator (automated, screenshots kept); all 16 of CPF's official AW-ceiling examples reproduce month by month. Two independent verification passes by a second model (Codex `gpt-6.1-sol`) found errors in the research and the payroll choices; all were fixed with citations (`packages/sg-rules/VERIFICATION.md`, `research/verification/`).
- **Security:** an independent review found 8 high, 12 medium and several low issues (privilege paths around hr_admin, approval escalation, MFA edge cases, payroll adjustment runs, CSV injection, body limits, backups). All confirmed findings are fixed, each with a regression test, and re-checked by re-running the reviewer's probes against merged `main`.

## Known limitations (see `docs/limitations.md` for the full list)

- **Government and bank integrations need onboarding we cannot do for users.** Singpass/Myinfo/Corppass require each employer to register as a relying party (our Singpass client is tested against a mock only). IRAS AIS and CPF APIs need vendor approval: v1 produces the CPF EZPay file and IR8A import rows for manual upload. DBS/OCBC/UOB-specific bank formats are not built; the bank file is generic pain.001.
- **Legal edge cases CPF hasn't published rules for are refused, not guessed** (e.g. very low wages with a capped bonus).
- **No remote push notifications** (in-app inbox and email only).
- **Small UI gaps** remain as unticked OpenSpec tasks: device-session e2e, claims report breakdowns, Settings → Claim types e2e, SSO round-trip e2e, audit-log export e2e, setup-checklist e2e, System page e2e, payroll-cutoff reminder source.
- **CI** is green on GitHub Actions in the private repo (lint, typecheck, four test shards, build, docs, audit, Playwright against Postgres 17, Docker install smoke). Its first runs found a timezone bug in the date picker, now fixed.
- The Singpass button uses text, not the official logo (not redistributable under MIT).

## Mobile apps: what remains

- **Store release:** the app icon is done (`design/app-icon/`); the iOS bundle id `crowtech.crowhr` is registered with Apple, the Play Console app exists as a draft (app id 4976368088435434771), the App Store Connect app exists (Apple ID 6831992308). With Daniel's approval, iOS build 2 is uploaded for internal TestFlight and Android versionCode 1 is a draft on Play internal testing; the Play store listing is saved as a draft. Nothing is published. Store metadata and the "Data Not Collected" answers are drafted for review.
- **iOS accessibility sign-off (task 3.7):** Xcode's audit flags one Dynamic Type item per run, changing between runs; needs a manual pass on a real device.
- Privacy and support pages are written on the landing branch (noindex until launch).

## Needs Daniel

1. **GitHub:** pushed to the private repo and CI is green. Making it public is a separate decision.
2. **Placeholders:** the repo is `github.com/Crow-Tech-Pte-Ltd/CrowHR` (private); `security@crow.sg` and `conduct@crow.sg` are assumed in docs and README.
3. **Deploy hr.crow.sg:** demo at `/` and docs at `/docs` on Cloudflare Pages, following `docs/deploy-demo.md`. Needs approval and a DNS change.
4. **Landing page:** pushing `crow-hr-product-page` and opening a PR publishes a Cloudflare preview at a public pages.dev URL. Flipping `CROW_HR_LAUNCHED` launches it.
5. **Mobile app release:** approve an app icon; approve registering `crowtech.crowhr` and creating the App Store Connect and Play Console entries; review the "Data Not Collected" / Data safety answers (the design asks for a policy check); decide how store reviewers get a server and account (a reviewer server, or the public demo exposing its API). Push notifications stay off in v1 (in-app inbox, background refresh, local notifications); a relay or UnifiedPush is a later, opt-in decision.
6. **Optional:** ask IRAS (data_mgmt@iras.gov.sg) whether a self-hosted product can use the AIS API; a real company's Singpass staging test.

## How it was built

Specification-first with OpenSpec (17 changes), test-driven, by a lead agent coordinating Claude Opus 5.5 subagents in isolated git worktrees, with Codex `gpt-6.1-sol` for independent verification and, after the Claude weekly limit was reached, for the security fixes. Each workstream was merged by the lead only after a full check, with migrations regenerated rather than hand-merged.
