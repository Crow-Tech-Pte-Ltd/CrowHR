## 1. Research

- [x] 1.1 `research/`: record the Appendix 8A/8B rules, the template's appendix sheets and the AIS data items with sources and effective YA in `sg-ir8a-appendices.md`; mark the leap-year day basis, rounding and paste behaviour UNVERIFIED or AMBIGUOUS. Proof: document review (no code).

## 2. Statutory rules (`packages/sg-rules`)

- [x] 2.1 Rule tables `APPENDIX_8A_RULES` and `APPENDIX_8B_RULES` with sources and effective dates, registered in `ruleFamilies`. Test: `tables/tables.test.ts` data-integrity test passes with the new families.
- [x] 2.2 Residence, hotel, car and other-benefit calculators and the Appendix 8A total. Test: `tax/appendix-8a.test.ts` reproduces EN-8A's example (S$9,347.25), Accommodation Examples 1–4 and Car Examples 1–5 to the cent, rejects invalid input with how-to-fix messages and refuses computed annual value in a leap year.
- [x] 2.3 Share-gain calculator, decimal parsing and Appendix 8B totals. Test: `tax/appendix-8b.test.ts` reproduces the e-Tax guide's Annex C examples, splits S10(1)(b)/(g) at 1 Jan 2003, drops decimals beyond the cent and rejects losses and out-of-year dates.
- [x] 2.4 sg-rules line coverage stays ≥ 95%. Test: `bun run coverage:sg-rules`.

## 3. Storage and API (`packages/core`)

- [x] 3.1 Table `payroll_ir8a_appendix_entries` and its migration. Test: `testing/schema.payroll.test.ts` (tenant table guard) and migrations apply on PGlite.
- [x] 3.2 Service and routes: list, create, replace, delete with validation, limits, `payroll:read`/`payroll:update` and audit events. Test: `payroll/ir8a-appendix.http.test.ts` (create/list/update/delete, 403 for hr_admin and employees, foreign employee 404, limits, audit events).
- [x] 3.3 Cross-organisation isolation: seed one appendix entry in the sweep. Test: `access/cross-org.test.ts`.
- [x] 3.4 IR8A preview totals (d7(a), d7(b), d8), appendix-only employees and appendix row counts per part. Test: `payroll/ir8a-appendix.http.test.ts` and `payroll/year.http.test.ts`.
- [x] 3.5 Appendix CSV sheets per part with verbatim headers, locked cells empty, owned-premises note, recent authentication and audit. Test: `payroll/files/ir8a-appendix.test.ts` (row builders) and `payroll/ir8a-appendix.http.test.ts` (downloads).
- [x] 3.6 OpenAPI snapshot updated, no breaking change against v1.0. Test: `bun run openapi:check`.

## 4. Web (`apps/web`)

- [x] 4.1 Year end screen with Appendix 8A and 8B tables and add/edit dialogs per kind showing computed values and working; loading, empty, error and success states. Test: `e2e/payroll/payroll.payroll.ts` records a benefit and a share gain and sees the totals.
- [x] 4.2 IR8A panel: link to the Year end screen and appendix downloads per part. Test: same e2e spec downloads an appendix sheet.

## 5. Documentation

- [x] 5.1 `apps/docs` IR8A page: what to record, computed vs entered, template sheets and pasting, out of scope; remove the Appendix 8A/8B limitation from `docs/limitations.md` and the docs limitations page. Test: `bun run docs:build` (links and pages build).
- [x] 5.2 Full `bun run check` and the payroll Playwright spec pass before the PR.
