# Crow HR — engineering report

**Status as of 1 November 2026, `main` @ the commit that adds this file.** Nothing has been pushed, deployed or published.

## Summary

Crow HR is a working, self-hostable HR and payroll platform for Singapore SMEs, MIT-licensed and built from scratch in TypeScript. Every web module in the original brief is implemented, integrated and tested end to end. Statutory calculations are checked against CPF Board's own calculator and an independent second model. An independent security review found 25 defects, and every confirmed one is fixed and re-verified against the reviewer's own probes. The mobile apps (milestone M4) are specified but not started.

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
| Landing page | `/apps/crow-hr` in crow-tech-landing on branch `crow-hr-product-page`, unlisted behind `CROW_HR_LAUNCHED = false`, noindex |

## Verification

- **Automated:** 2,182 core/integration tests + 419 statutory-engine tests (99.7% line coverage, ≥95% enforced), 41 Playwright end-to-end tests, 3 demo end-to-end tests, docs build with link check. All green on `main`.
- **Statutory correctness:** 91 researched test vectors; 15/15 cases match CPF Board's online calculator (automated, screenshots kept); all 16 of CPF's official AW-ceiling examples reproduce month by month. Two independent verification passes by a second model (Codex `gpt-6.1-sol`) found errors in the research and the payroll choices; all were fixed with citations (`packages/sg-rules/VERIFICATION.md`, `research/verification/`).
- **Security:** an independent review found 8 high, 12 medium and several low issues (privilege paths around hr_admin, approval escalation, MFA edge cases, payroll adjustment runs, CSV injection, body limits, backups). All confirmed findings are fixed, each with a regression test, and re-checked by re-running the reviewer's probes against merged `main`.

## Known limitations (see `docs/limitations.md` for the full list)

- **Government and bank integrations need onboarding we cannot do for users.** Singpass/Myinfo/Corppass require each employer to register as a relying party (our Singpass client is tested against a mock only). IRAS AIS and CPF APIs need vendor approval: v1 produces the CPF EZPay file and IR8A import rows for manual upload. DBS/OCBC/UOB-specific bank formats are not built; the bank file is generic pain.001.
- **Legal edge cases CPF hasn't published rules for are refused, not guessed** (e.g. very low wages with a capped bonus).
- **No remote push notifications** (in-app inbox and email only).
- **Small UI gaps** remain as unticked OpenSpec tasks: device-session e2e, claims report breakdowns, Settings → Claim types e2e, SSO round-trip e2e, audit-log export e2e, setup-checklist e2e, System page e2e, payroll-cutoff reminder source.
- **CI** is green on GitHub Actions in the private repo (lint, typecheck, four test shards, build, docs, audit, Playwright against Postgres 17, Docker install smoke). Its first runs found a timezone bug in the date picker, now fixed.
- The Singpass button uses text, not the official logo (not redistributable under MIT).

## Not started

- **Mobile apps (M4):** native SwiftUI + Kotlin/Compose, zero data collection, specified in `openspec/changes/add-mobile-apps`. Building and publishing follows `/home/daniel/Gremia/AGENTS.md` and needs the s5 Mac and the store accounts.

## Needs Daniel

1. **GitHub:** pushed to the private repo and CI is green. Making it public is a separate decision.
2. **Placeholders:** the repo is `github.com/Crow-Tech-Pte-Ltd/CrowHR` (private); `security@crow.sg` and `conduct@crow.sg` are assumed in docs and README.
3. **Deploy hr.crow.sg:** demo at `/` and docs at `/docs` on Cloudflare Pages, following `docs/deploy-demo.md`. Needs approval and a DNS change.
4. **Landing page:** pushing `crow-hr-product-page` and opening a PR publishes a Cloudflare preview at a public pages.dev URL. Flipping `CROW_HR_LAUNCHED` launches it.
5. **Mobile apps:** go-ahead to start M4, and a decision on push notifications (none, a Crow-run relay, or UnifiedPush).
6. **Optional:** ask IRAS (data_mgmt@iras.gov.sg) whether a self-hosted product can use the AIS API; a real company's Singpass staging test.

## How it was built

Specification-first with OpenSpec (17 changes), test-driven, by a lead agent coordinating Claude Opus 5.5 subagents in isolated git worktrees, with Codex `gpt-6.1-sol` for independent verification and, after the Claude weekly limit was reached, for the security fixes. Each workstream was merged by the lead only after a full check, with migrations regenerated rather than hand-merged.
