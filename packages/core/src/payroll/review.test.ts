import { describe, expect, it } from "vitest";
import type { PayrollPayslip, PayrollRun } from "../db/schema/payroll.ts";
import { item, payInput } from "../testing/payroll-input.ts";
import { computeEmployeePay } from "./engine/compute.ts";
import type { PayInput } from "./engine/types.ts";
import { diffRuns, toRow } from "./review.ts";

function slip(input: PayInput): PayrollPayslip {
  const result = computeEmployeePay(input);
  return {
    id: `slip-${input.employee.id}-${input.run.month}`,
    orgId: "org",
    runId: input.run.id,
    employeeId: input.employee.id,
    employeeNumber: input.employee.employeeNumber,
    employeeName: input.employee.legalName,
    input,
    inputHash: "x",
    result,
    resultHash: "y",
    grossCents: result.totals.grossCents,
    netCents: result.totals.netCents,
    netPayableCents: result.totals.netPayableCents,
    cpfEmployeeCents: result.totals.cpfEmployeeCents,
    cpfEmployerCents: result.totals.cpfEmployerCents,
    blockingCount: 0,
    warningCount: 0,
    releasedAt: null,
    createdAt: new Date(0),
  };
}

const person = (id: string, name: string) => ({ employee: { id, legalName: name } });

describe("changes since last month", () => {
  it("lists joiners, leavers, raises and new items", () => {
    const sep = (o: object) => payInput({ run: { month: "2026-09", id: "sep" }, ...o });
    const oct = (o: object) => payInput({ run: { month: "2026-10", id: "oct" }, ...o });
    const previous = [
      slip(sep(person("e1", "Aw Chee Keong"))),
      slip(sep(person("e2", "Bala Krishnan"))),
      slip(sep(person("e3", "Chua Siew Lan"))),
    ];
    const current = [
      slip(oct(person("e1", "Aw Chee Keong"))),
      slip(
        oct({
          ...person("e2", "Bala Krishnan"),
          compensation: [{ from: "2020-01-01", to: null, payBasis: "monthly", amountCents: 420_000 }],
        }),
      ),
      slip(oct({ ...person("e3", "Chua Siew Lan"), employment: { lastWorkingDay: "2026-10-15" } })),
      slip(oct({ ...person("e4", "Isabel Tan"), employment: { hireDate: "2026-10-16" } })),
      slip(
        oct({
          ...person("e5", "Kavitha Raj"),
          items: [
            item({ kind: "bonus", label: "Bonus", amountCents: 100_000, wageClass: "AW", awPayableDate: "2026-10-20" }),
          ],
        }),
      ),
    ];
    const run = { periodStart: "2026-10-01", periodEnd: "2026-10-31" } as PayrollRun;
    const changes = diffRuns(current, previous, run);
    expect(changes.map((c) => [c.kind, c.name])).toEqual([
      ["basic_changed", "Bala Krishnan"],
      ["left", "Chua Siew Lan"],
      ["joined", "Isabel Tan"],
      ["joined", "Kavitha Raj"],
      ["new_item", "Kavitha Raj"],
    ]);
    expect(changes[0]?.text).toBe("Basic pay S$4,000.00 → S$4,200.00.");
    expect(changes[2]?.text).toBe("Joined on 16 Oct 2026, pay pro-rated (11 of 22 working days).");
    expect(toRow(current[3] as PayrollPayslip).flags).toContain("joiner");
  });
});
