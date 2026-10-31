## Context

See proposal.md for motivation. `packages/sg-rules` must stay pure and dependency-free: it runs in Node and in the browser demo. Its consumer is the future payroll run in `packages/core`, which will persist runs and payslips. Research inputs are `research/sg-regulatory.md`, `research/sg-rule-tables.json` and `research/sg-test-vectors.json`. An independent verification is in `research/verification/codex-verification.md`; its resolutions are recorded in `packages/sg-rules/VERIFICATION.md`.

## Goals / Non-Goals

**Goals:** exact results that match CPF's own worked examples to the dollar; every number traceable to a dated source; an API whose state a payroll run can persist month to month; refusing a case outright rather than inventing law.

**Non-Goals:** classifying pay items (OW vs AW, CPF-ability, the 14th-of-next-month OW test); persistence; parental leave schemes; part-time leave in hours; the CPF submission file.

## Decisions

**Tables as typed TS modules in `src/tables/`, not JSON.** The compiler checks the shapes, so no runtime validator or dependency is needed. Each row carries its own `source` and `effectiveFrom`/`effectiveTo`. The CPF rows were generated from the research JSON and machine-checked against the CPF PDFs. The directory is `tables/`, not `data/`, because the root `.gitignore` ignores every `data/` directory and Biome would silently skip it. *Alternative:* JSON plus a validator, which adds a dependency or hand-written code for no gain.

**Half-open intervals `[effectiveFrom, effectiveTo)` everywhere.** `pickInForce` finds exactly one row per family. A test asserts that families are contiguous from the coverage start (1 Jan 2025) and have no overlaps. Rows without a published start date use the coverage start and are marked `ENGINE_COVERAGE_START`, so no history is claimed.

**Exact rationals with bigint; rounding only at named points.** Inputs are integer cents and bps. Intermediates are `ExactCents {n, d}`. Rounding uses named functions (`roundHalfUpToDollar`, `floorToDollar`, `roundHalfUpToCent`, `ceilToCent`). This is required by the sub-cent rule (RD-03: $370.4958 → $370). *Alternative:* micro-dollar integers, which work for CPF but not for the OT and pro-ration divisions.

**CPF state is an explicit year-to-date record.** `computeCpf` takes `yearToDate = { owSubjectCents, awPayments[] }` and returns `yearToDateAfter`. Keeping every AW payment (payable month, OW of that month, AW payable, AW subject) is what makes CPF's procedure possible. At each AW payment (estimate) and in December, the last month or after leaving (actual), the engine re-allocates the ceiling over earlier AW in chronological order. Each delta is priced at the rate table, age band and wage band of the month that AW was payable. The combined exact amount is rounded once, which reproduces CPF examples 9 and 14 (where rounding each month separately would give $6,055 instead of $6,054). A shortfall is returned separately from the month's own contribution. An excess is reported for a CPF refund, never netted. *Alternative:* a bare "YTD AW subject" number, which cannot re-subject earlier AW at historical rates (examples 11, 13, 14).

**Blocked results instead of guesses.** `CpfMonthResult | CpfBlockedResult` is a discriminated union (`ok`). The unpublished low-wage/capped-AW case returns `ok: false` with a blocking issue, so payroll cannot silently post an invented amount. Invalid input (negative or non-integer money, bad dates, AW history from another year) throws `SgRulesInputError`. Missing rule data throws `RulesNotAvailableError`.

**Overtime default reproduces MOM's published example.** `MOM_PUBLISHED_CAP` takes the exact hourly basic rate, but non-workmen are never paid above $13.60/h. This gives $40.80 for MOM's example and keeps pay monotone just below $2,600. `EXACT_FORMULA` is an explicit option.

**Working trace and issues on every result.** `working: {code, text}[]` holds plain-English steps with the real numbers, for payslip drill-down and audit. `issues: {code, severity, message, source?}[]` carries info, warnings and blocking items. Warnings never throw (for example the 72-hour OT limit).

**Country abstraction kept minimal.** `CountryRules<TInput, TState, TOutcome>` has identity, coverage, `initialState()`, `computeEmployeeMonth` (statutory lines + working + issues + next state) and `computeEmployerMonth` (cross-employee rounding such as SDL). Payroll stores `TState` opaquely. Nothing about Malaysia is assumed beyond this shape.

## Risks / Trade-offs

- [The interpretation behind derived vectors is wrong in CPF's own calculator] → VERIFICATION.md lists the vectors needing a human spot-check before go-live.
- [Payroll classifies pay items incorrectly (e.g. late OT as OW)] → out of scope here. The engine's inputs are named and documented so the classification lives in one place in core.
- [CPF publishes 2028 rates] → the 2027 tables carry forward with a warning until a new row is added. Update every May.
- [Known leaving month changes the AW-ceiling estimate] → the engine shortens the projection when `lastMonth` is given. CPF's examples behave as if it is unknown. Both reconcile at Step 2. Payroll decides when to record it.

## Migration Plan

New code only. The previous placeholder `CountryRules` (identity only) is replaced by the generic interface, and `singaporeRules` keeps `country`, `name` and `currency`. There are no consumers yet.

## Open Questions

Legal ambiguities that do not change this design (delayed AW across a rate change, SPR election timing, the low-wage/capped-AW rule) are listed in `packages/sg-rules/VERIFICATION.md`.
