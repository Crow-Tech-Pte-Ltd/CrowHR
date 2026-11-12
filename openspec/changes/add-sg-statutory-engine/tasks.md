## 1. Rule data (packages/sg-rules)

- [x] 1.1 Copy `research/sg-test-vectors.json` to `src/__fixtures__/`, correcting AW-11 and SPR-04 per the verification; verified by `src/vectors.test.ts` loading it
- [x] 1.2 Encode CPF Tables 1–5 for 2025–2027, OW ceiling and Annual Salary Ceiling with sources in `src/tables/cpf.ts`; verified by `src/tables/tables.test.ts` (internal consistency, 2026 maxima) and the PDF cross-check recorded in VERIFICATION.md
- [x] 1.3 Encode SDL (2008 and 2026 rows, exemptions), SHG tables, Employment Act constants, annual/sick leave, 2026/2027 public holidays and FWL rates; verified by `src/tables/tables.test.ts`
- [x] 1.4 `resolveRules(date)` with `[from, to)` intervals, plus a gap/overlap/source integrity check; verified by `src/tables/tables.test.ts` (31 Dec 2026 / 1 Jan 2027 boundary, coverage refusal)

## 2. CPF (packages/sg-rules)

- [x] 2.1 Age band (month after the birthday) and SPR year/election resolution; verified by `src/cpf/cpf.test.ts` age and SPR suites
- [x] 2.2 `computeCpf` with wage bands, OW ceiling, exact rounding and working trace; verified by the 62 CPF vectors in `src/vectors.test.ts` and the ±1-cent boundary suite in `src/cpf/cpf.test.ts`
- [x] 2.3 AW ceiling estimate/actual, chronological re-allocation, shortfall and excess (`reconcileAdditionalWages`); verified by all 16 official examples in `src/cpf/aw-official-examples.test.ts`
- [x] 2.4 Blocked result for low wages with capped AW, rejection of negative wages and `diffCpf` for corrections; verified by `src/cpf/cpf.test.ts`

## 3. SDL and SHG (packages/sg-rules)

- [x] 3.1 `computeSdl` / `computeSdlTotal` (exact per employee, floor of the total, zero when no wages, exemptions); verified by the 12 SDL vectors and `src/levies.test.ts`
- [x] 3.2 `determineShgFunds` and `computeShg`; verified by the 17 SHG vectors and `src/levies.test.ts`

## 4. Employment Act, leave and holidays (packages/sg-rules)

- [x] 4.1 Part 4 coverage, hourly/daily rates, overtime (MOM $40.80 example, 72 h warning); verified by `src/employment-act/employment-act.test.ts`
- [x] 4.2 Working-day calendar, incomplete-month salary, rest-day and public-holiday work pay, time off in lieu; verified by `src/employment-act/employment-act.test.ts` (MOM 2026 table, 36 cells)
- [x] 4.3 Annual leave (3-month gate, first/last-year pro-ration), sick leave, public holidays and holiday treatment; verified by `src/employment-act/leave-and-holidays.test.ts`
- [x] 4.4 Part-time leave in hours and parental/childcare leave schemes — NOT IMPLEMENTED in this change (handoff to the leave module; see VERIFICATION.md) — DONE later in add-leave (part-time hours, parental/childcare schemes)

## 5. FWL and country interface (packages/sg-rules)

- [x] 5.1 `estimateLevy` (estimate only, daily rate for part months, never deductible); verified by `src/levies.test.ts`
- [x] 5.2 `CountryRules` interface and `singaporeRules` (statutory lines, state, employer SDL); verified by `src/singapore.test.ts`

## 6. Verification and checks

- [x] 6.1 Resolve every disagreement in `research/verification/statutory-data-review.md` and record it, with the vectors needing a CPF-calculator spot-check, in `packages/sg-rules/VERIFICATION.md`; verified by the file's disagreement table
- [x] 6.2 `bun run check` passes on a clean tree with this change, and sg-rules line coverage is ≥ 95% (measured 98.8%); verified by running both
- [x] 6.3 Spot-check the vectors listed in VERIFICATION.md in CPF's online calculator — needs a human — DONE: 15/15 cases matched CPF Board\'s online calculator via Playwright (VERIFICATION.md, "CPF calculator check")
- [x] 6.4 Add `@vitest/coverage-v8` and a 95% line threshold for sg-rules to the workspace — needs the `bun.lock` owner (out of this change's lane) — DONE: v8 coverage, ≥95% enforced in `bun run check`
