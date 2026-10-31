## Context

Each module owns its data and must stay buildable by a separate workstream. Leave, attendance and payroll are not yet specced (they wait on regulatory research). Reporting therefore defines a contract those modules plug into, and implements only the people reports itself. Requirements are in `specs/reporting`.

## Goals / Non-Goals

**Goals:** reports added by dropping a `reports.ts` into a module, with no edits to `reporting/`; one redaction path shared with the API; exports that open correctly in Excel on Windows (BOM, dates) and are exact for money.

**Non-Goals:** query caching or materialised views. SME data volumes (≤ 200 employees × a few years) run directly.

## Decisions

1. **`ReportDefinition`.** The shape:

   ```ts
   {
     id: 'people.headcount', module: 'employees', title, description,
     permission: { resource, action: 'read' },
     params: zodSchema,
     columns: [{ key, title, type, sensitivity?, total?: 'sum' | 'none' }],
     defaultSort,
     run(ctx, params, { scope }) → AsyncIterable<Row>,
   }
   ```

   Modules register definitions at app construction, so a disabled module registers none. `run` receives the resolved scope filter (all, or an employee-ID set) and must use it. A shared conformance test runs every registered definition as a manager and as an out-of-org owner to prove this. *Alternative:* SQL views per report owned by reporting, which couples reporting to every schema.

2. **Streaming rows.** `run` yields rows in batches of 500. The screen path takes one page plus totals. Totals are computed by the runner over the full scoped stream, not by the module. The export path streams into the writer. 50 000 rows × ~20 columns fits comfortably in memory even in the demo, but streaming keeps the server flat.

3. **Writers.** `export/csv.ts` is hand-written: BOM, quoting, formula-injection prefix, and money formatted from cents with integer maths (`(c / 100) | 0` and `c % 100`, with care for negatives). `export/xlsx.ts` wraps `write-excel-file` if its universal build passes the core runtime-agnostic import test, and otherwise uses a minimal writer on `fflate`: one shared-strings table, number formats and date serials. XLSX money cells are written as `cents / 100`. Every cent value below 2^53 / 100 round-trips exactly as a double to 2 decimal places, which a test asserts for the boundaries.

4. **Turnover and headcount live in `employees/reports.ts`** using the as-at helpers. Leavers' voluntary/involuntary split maps from `tenures.cessation_reason`.

5. **Payroll cost contract** (implemented by payroll, specified here). Rows are per finalised run month × department or cost centre: `grossCents`, `employerCpfCents`, `sdlCents`, `fwlCents`, `employerTotalCents`, `employeeCpfCents`, `shgCents`, `headcount`. The department is taken from the employment record as at the run's period end.

6. **Audit.** Exports are audited through `audit.record('report.exported', …)` with parameters and `redactedColumns`. Screen views are not audited, except for reports with sensitive columns shown.

## Data model sketch

No new tenant tables. Reports are code. The audit log stores export events.

## Risks / Trade-offs

- [Modules forgetting to apply scope] → the conformance test, run in CI over every registered definition.
- [XLSX library compatibility with runtime-agnostic core] → the fallback minimal writer, chosen by an explicit test.
- [Department changes mid-period skew per-department figures] → the documented rule (as at period end), shown under the table.
