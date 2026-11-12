import { eq } from "drizzle-orm";
import { allowanceTypes } from "../db/schema/employees.ts";
import { payrollIr8aAppendixEntries } from "../db/schema/ir8a.ts";
import {
  payrollAllowanceSettings,
  payrollPayslips,
  payrollRunItems,
  payrollRuns,
  payrollSettings,
} from "../db/schema/payroll.ts";
import type { AppDeps } from "../deps.ts";
import { canonicalHash } from "../payroll/engine/canonical.ts";
import { computeEmployeePay } from "../payroll/engine/compute.ts";
import { payInput } from "./payroll-input.ts";

/** One row in every payroll table for `orgId` (cross-organisation isolation sweep). */
export async function seedPayrollOnePerTable(deps: AppDeps, orgId: string, employeeId: string): Promise<void> {
  const db = deps.db;
  await db.insert(payrollSettings).values({ orgId });
  const [type] = await db.select().from(allowanceTypes).where(eq(allowanceTypes.orgId, orgId)).limit(1);
  if (type)
    await db
      .insert(payrollAllowanceSettings)
      .values({ orgId, allowanceTypeId: type.id, cpfLiable: true, prorate: true });
  const runId = deps.ids.newId();
  await db.insert(payrollRuns).values({
    id: runId,
    orgId,
    kind: "regular",
    month: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    payDate: "2026-10-30",
    status: "approved",
  });
  await db.insert(payrollRunItems).values({
    id: deps.ids.newId(),
    orgId,
    runId,
    employeeId,
    kind: "bonus",
    label: "Bonus",
    amountCents: 10_000,
    wageClass: "AW",
    awPayableDate: "2026-10-30",
  });
  const input = payInput({ run: { id: runId }, employee: { id: employeeId } });
  const result = computeEmployeePay(input);
  await db.insert(payrollPayslips).values({
    id: deps.ids.newId(),
    orgId,
    runId,
    employeeId,
    employeeNumber: "E0001",
    employeeName: "Sweep",
    input,
    inputHash: await canonicalHash(input),
    result,
    resultHash: await canonicalHash(result),
    grossCents: result.totals.grossCents,
    netCents: result.totals.netCents,
    netPayableCents: result.totals.netPayableCents,
    cpfEmployeeCents: result.totals.cpfEmployeeCents,
    cpfEmployerCents: result.totals.cpfEmployerCents,
    blockingCount: 0,
    warningCount: 0,
    releasedAt: deps.clock.now(),
  });
  // IR8A Appendix 8A/8B (add-ir8a-appendix-8a-8b): one entry, so PUT/DELETE /payroll/ir8a/appendices/:id are swept.
  await db.insert(payrollIr8aAppendixEntries).values({
    id: deps.ids.newId(),
    orgId,
    employeeId,
    year: 2026,
    kind: "hotel",
    details: { kind: "hotel", costCents: 10_000, paidByEmployeeCents: 0, note: null },
  });
}
