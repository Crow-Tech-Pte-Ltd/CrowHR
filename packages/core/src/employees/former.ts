import { and, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { tenures } from "../db/schema/employees.ts";
import type { AppDeps } from "../deps.ts";
import { singaporeToday } from "./dates.ts";
import type { MembershipsPort } from "./ports.ts";

/**
 * Lifecycle hook for access-control's `former` transition. From the day after
 * the last working day, the employee's membership loses its roles and becomes
 * `former`. Runs from the workflows `tick(now)` sweep (WS3); idempotent, and
 * skips tenures followed by a rehire. Returns the number of transitions run.
 */
export async function runFormerTransitions(
  deps: AppDeps,
  memberships: MembershipsPort,
  now: Date = deps.clock.now(),
): Promise<number> {
  const today = singaporeToday(now);
  const due = await deps.db
    .select()
    .from(tenures)
    .where(
      and(
        isNotNull(tenures.lastWorkingDay),
        lt(tenures.lastWorkingDay, today),
        isNull(tenures.formerTransitionAt),
        sql`not exists (select 1 from tenures later where later.org_id = ${tenures.orgId} and later.employee_id = ${tenures.employeeId} and later.hire_date > ${tenures.hireDate})`,
      ),
    );
  for (const t of due) {
    // One transaction per tenure: the membership change, its audit event and the marker commit together.
    await deps.db.transaction(async (tx) => {
      await memberships.markFormer(
        { orgId: t.orgId, employeeId: t.employeeId, lastWorkingDay: t.lastWorkingDay as string },
        tx,
      );
      await tx.update(tenures).set({ formerTransitionAt: now }).where(sql`${tenures.id} = ${t.id}`);
    });
  }
  return due.length;
}
