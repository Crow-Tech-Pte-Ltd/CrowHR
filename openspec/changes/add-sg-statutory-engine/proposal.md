## Why

Payroll is the core of Crow HR, and every Singapore payslip depends on statutory amounts (CPF, SDL, SHG funds, Employment Act overtime and pro-ration) that are easy to get subtly wrong: CPF's whole-dollar rounding, the month-after-birthday age rule, SPR year boundaries and the Additional Wage ceiling recomputation are the classic sources of $1 errors and CPF shortfalls. `packages/sg-rules` is currently a skeleton. The payroll run (in `packages/core`, later) needs a pure, exact, cited engine to call before it can be built.

## What Changes

- Effective-dated, cited rule data in `packages/sg-rules/src/data/`: CPF rate Tables 1–5 for 2025, 2026 and 2027, OW ceiling, Annual Salary Ceiling, SDL, the four SHG fund tables, Employment Act Part 4 thresholds and overtime constants, annual/sick leave entitlement tables, 2026/2027 gazetted public holidays and Foreign Worker Levy rates. Money is integer cents, rates are basis points, every entry carries `effectiveFrom`/`effectiveTo` and a `source` URL.
- `resolveRules(date)` picks the rule versions in force, and a data-integrity test fails on gaps, overlaps or uncited entries.
- CPF calculator for one employee-month with a human-readable working trace: age band, SPR year and G/G, F/G, F/F election, wage band on pre-cap total wages, OW ceiling, AW ceiling estimate/actual with chronological re-subjection of earlier AW at the rate of the month it was paid, CPF's exact rounding (total half-up to the dollar on the exact amount, employee floored, employer = difference).
- SDL per employee (exact) and per employer (sum, then floor to the dollar).
- SHG fund determination (race, religion, residency/pass, opt-out, additional funds, fixed amounts) and contribution by total wages.
- Employment Act helpers: Part 4 coverage, hourly/daily basic rates, 1.5× overtime with the $2,600 non-workman base cap and the 72 h/month warning, incomplete-month salary with MOM working-day calendars, rest-day and public-holiday work pay, time-off-in-lieu eligibility, annual leave (3-month gate, first/last-year pro-ration with MOM rounding), sick leave by completed months, public holidays per year.
- `estimateLevy` for Foreign Worker Levy cost reports only. It is never a salary deduction.
- A minimal `CountryRules` interface (identity `SG`) that the payroll module depends on, so a future `my-rules` package can implement it.
- `packages/sg-rules/VERIFICATION.md` records how the research vectors were checked, every disagreement with the independent verification and its resolution, and the vectors that need a human spot-check in CPF's calculator.

## Capabilities

### New Capabilities
- `sg-statutory-rules`: exact computation of Singapore statutory payroll amounts (CPF, SDL, SHG, Employment Act pay and leave entitlements, FWL estimate) from effective-dated, cited rule tables, with a working trace and warnings.

### Modified Capabilities
None.

## Impact

- Code: `packages/sg-rules/` only (new modules, tests, fixtures, `VERIFICATION.md`). No runtime dependencies are added.
- Consumers: `packages/core` payroll (future) calls the public API. Persisted per-employee monthly state (YTD OW subject, AW payment history) is defined by this package's types but stored by core.
- `docs/limitations.md` still lists sg-rules as a skeleton. That entry belongs to the platform owner and should be updated by them; this change reports it instead of editing outside its lane.

## Non-goals

- Payroll runs, payslips, persistence, the CPF EZPay file, IR8A/AIS, GIRO files.
- Pay-item classification (deciding whether an item is OW or AW, CPF-able, or late-payable after the 14th). The caller classifies items; the engine computes on the totals it is given.
- Part-time leave in hours, parental/childcare leave schemes and Government-paid leave claims.
- An authoritative FWL bill: MOM's bill is authoritative and the levy is never deducted.
- Malaysia or any other country beyond the interface shape.
