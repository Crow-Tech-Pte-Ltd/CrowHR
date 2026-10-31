import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeSubjects, createWorkflowWorld, movableClock, type WorkflowWorld } from "../../testing/index.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { notifications } from "../db/schema/notifications.ts";
import { tick } from "../jobs/tick.ts";
import { addDays, formatSgDate } from "./reminders.ts";
import type { DueReminder, ReminderSource } from "./types.ts";

/**
 * The payroll-cutoff ReminderSource contract (task 4.3). The real source belongs to the payroll
 * change, which reads the cutoff date from payroll settings; this double shows the shape it must
 * have: 3 days before the cutoff, to payroll_admins, one per pay period.
 */
function payrollCutoffDouble(cutoffs: { orgId: string; period: string; cutoffOn: string }[]): ReminderSource {
  return {
    id: "payroll_cutoff",
    async due(db, { today }) {
      const out: DueReminder[] = [];
      for (const c of cutoffs) {
        if (today < addDays(c.cutoffOn, -3) || today > c.cutoffOn) continue;
        const admins = await db
          .select({ id: membershipRoles.membershipId })
          .from(membershipRoles)
          .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
          .where(
            and(
              eq(membershipRoles.orgId, c.orgId),
              eq(membershipRoles.role, "payroll_admin"),
              eq(memberships.status, "active"),
            ),
          );
        out.push({
          orgId: c.orgId,
          subjectKey: c.period,
          threshold: "d3",
          dueOn: c.cutoffOn,
          recipients: admins.map((a) => a.id),
          kind: "payroll_cutoff",
          title: `Payroll cutoff for ${c.period} is on ${formatSgDate(c.cutoffOn)}`,
          link: "/payroll",
          concerns: null,
        });
      }
      return out;
    },
  };
}

describe("payroll cutoff reminder (contract with a double)", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-11-18T01:00:00.000Z");
  const cutoffs: { orgId: string; period: string; cutoffOn: string }[] = [];
  beforeEach(async () => {
    clock.set("2026-11-18T01:00:00.000Z");
    cutoffs.length = 0;
    w = await createWorkflowWorld({
      clock,
      workflowPlugins: [createFakeSubjects().plugin, { name: "payroll", reminders: [payrollCutoffDouble(cutoffs)] }],
    });
    cutoffs.push({ orgId: w.org.id, period: "2026-11", cutoffOn: "2026-11-25" });
  });
  afterEach(() => w.close());

  it("goes to payroll_admins 3 days before the cutoff, once", async () => {
    const DAY = 86_400_000;
    for (let d = 0; d < 10; d++) {
      await tick(w.deps);
      clock.advance(DAY);
    }
    const notes = await w.deps.db.select().from(notifications).where(eq(notifications.kind, "payroll_cutoff"));
    expect(notes.map((n) => [n.recipientMembershipId, n.title])).toEqual([
      [w.m.payroll.membershipId, "Payroll cutoff for 2026-11 is on 25 Nov 2026"],
    ]);
  });
});
