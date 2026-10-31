import { asc, eq, gte, lte } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { overtimeClaims } from "../db/schema/attendance.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";

/**
 * The payroll overtime feed (spec "Payroll overtime feed").
 *
 * `ApprovedOvertime` and `OvertimeSource` mirror `packages/core/src/payroll/ports.ts` on the WS4
 * payroll branch exactly; the integrator wires `attendanceOvertimeSource(deps)` into
 * `payrollPorts` at merge (then these local copies can be replaced by imports).
 */
export interface ApprovedOvertime {
  /** Stable id from attendance (idempotent import): the overtime claim id. */
  sourceId: string;
  employeeId: string;
  minutes: number;
  periodStart: string;
  periodEnd: string;
}

export interface OvertimeSource {
  listApproved(orgId: string, periodStart: string, periodEnd: string): Promise<ApprovedOvertime[]>;
}

/** Approved claims dated within [periodStart, periodEnd], one entry per claim (period = that date). */
export async function listApprovedOvertime(db: Db, orgId: string, periodStart: string, periodEnd: string) {
  const rows = await db
    .select()
    .from(overtimeClaims)
    .where(
      orgScope(db, orgId).where(
        overtimeClaims,
        eq(overtimeClaims.status, "approved"),
        gte(overtimeClaims.workDate, periodStart),
        lte(overtimeClaims.workDate, periodEnd),
      ),
    )
    .orderBy(asc(overtimeClaims.employeeId), asc(overtimeClaims.workDate));
  return rows.map(
    (r): ApprovedOvertime => ({
      sourceId: r.id,
      employeeId: r.employeeId,
      minutes: r.approvedMinutes ?? r.claimedMinutes,
      periodStart: r.workDate,
      periodEnd: r.workDate,
    }),
  );
}

export function attendanceOvertimeSource(deps: Pick<AppDeps, "db">): OvertimeSource {
  return { listApproved: (orgId, from, to) => listApprovedOvertime(deps.db, orgId, from, to) };
}
