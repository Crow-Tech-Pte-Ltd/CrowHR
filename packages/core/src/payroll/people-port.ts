import { and, desc, eq, inArray } from "drizzle-orm";
import { payrollBackpayNotices, payrollRuns } from "../db/schema/payroll.ts";
import type { AppDeps } from "../deps.ts";
import type { PayrollPort } from "../employees/ports.ts";

/**
 * Payroll's side of the people module's `PayrollPort`:
 * - `lastFinalisedPeriodEnd`: the last day of the latest approved or paid run's period, so a
 *   compensation change dated inside a finalised month needs `retroactive: true`;
 * - `notifyBackPay`: records the back pay owed; later runs warn on the employee until an approved
 *   run pays a "Back pay" item for them.
 */
export function payrollPeoplePort(deps: AppDeps): PayrollPort {
  return {
    async lastFinalisedPeriodEnd(orgId, db = deps.db) {
      const [row] = await db
        .select({ end: payrollRuns.periodEnd })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.orgId, orgId), inArray(payrollRuns.status, ["approved", "paid"])))
        .orderBy(desc(payrollRuns.periodEnd))
        .limit(1);
      return row?.end ?? null;
    },
    async notifyBackPay(notice, db = deps.db) {
      await db.insert(payrollBackpayNotices).values({
        id: deps.ids.newId(),
        orgId: notice.orgId,
        employeeId: notice.employeeId,
        compensationRecordId: notice.compensationRecordId,
        effectiveFrom: notice.effectiveFrom,
        previousAmountCents: notice.previousAmountCents,
        newAmountCents: notice.newAmountCents,
        createdAt: deps.clock.now(),
      });
    },
  };
}
