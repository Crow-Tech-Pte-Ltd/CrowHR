import { and, eq, inArray, or, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { memberships } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { payrollRunItems } from "../db/schema/payroll.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";

const EARNINGS_KINDS = ["bonus", "commission", "backpay", "other_earning", "overtime", "hours", "days_worked"];

/** Immutable audit provenance survives item edits/deletion and a later grant of the owner role. */
export async function selfEarningsEditors(db: Db, orgId: string, runId: string) {
  return db
    .selectDistinct({ membershipId: memberships.id, name: users.displayName })
    .from(auditEvents)
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, auditEvents.orgId), eq(memberships.id, auditEvents.actorMembershipId)),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(
      payrollRunItems,
      and(
        eq(payrollRunItems.orgId, auditEvents.orgId),
        eq(payrollRunItems.runId, runId),
        sql`${payrollRunItems.id}::text = ${auditEvents.meta}->>'itemId'`,
      ),
    )
    .where(
      orgScope(db, orgId).where(
        auditEvents,
        eq(auditEvents.targetType, "payroll_run"),
        eq(auditEvents.targetId, runId),
        inArray(auditEvents.action, ["payroll.item_added", "payroll.item_updated"]),
        or(
          sql`${auditEvents.meta}->>'selfEarnings' = 'true'`,
          // Older audit entries lack the flag. Adds name the employee; updates can use the item.
          and(
            sql`${auditEvents.meta}->>'selfEarnings' is null`,
            sql`${memberships.employeeId}::text = coalesce(${auditEvents.meta}->>'employeeId', ${payrollRunItems.employeeId}::text)`,
            inArray(sql<string>`${auditEvents.meta}->>'kind'`, EARNINGS_KINDS),
          ),
        ),
      ),
    );
}

/** Inputs that set earnings, including worked time for hourly/daily paid staff. */
export function isEarningsInput(kind: string): boolean {
  return EARNINGS_KINDS.includes(kind);
}
