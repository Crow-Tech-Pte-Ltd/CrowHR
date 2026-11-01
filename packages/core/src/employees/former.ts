import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { employees, tenures } from "../db/schema/employees.ts";
import { notifications } from "../db/schema/notifications.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { notify } from "../notifications/notify.ts";
import { singaporeToday } from "./dates.ts";
import type { MembershipsPort } from "./ports.ts";

/**
 * Lifecycle hook for access-control's `former` transition. From the day after
 * the last working day, the employee's membership loses its roles and becomes
 * `former`. Runs from the workflows `tick(now)` sweep (WS3); idempotent, and
 * skips tenures followed by a rehire. Returns the number of transitions run.
 *
 * Each tenure is its own transaction and its own try: one that can't complete (the leaver is the
 * last active owner, say) is retried on the next sweep and never blocks the others, in this
 * organisation or another (review #7). The owners are told once.
 */
export async function runFormerTransitions(
  deps: AppDeps,
  memberships: MembershipsPort,
  now: Date = deps.clock.now(),
  opts: { orgId?: string } = {},
): Promise<number> {
  const today = singaporeToday(now);
  const due = await deps.db
    .select()
    .from(tenures)
    .where(
      and(
        opts.orgId ? orgScope(deps.db, opts.orgId).where(tenures) : undefined,
        isNotNull(tenures.lastWorkingDay),
        lt(tenures.lastWorkingDay, today),
        isNull(tenures.formerTransitionAt),
        sql`not exists (select 1 from tenures later where later.org_id = ${tenures.orgId} and later.employee_id = ${tenures.employeeId} and later.hire_date > ${tenures.hireDate})`,
      ),
    );
  let done = 0;
  for (const t of due) {
    try {
      // One transaction per tenure: the membership change, its audit event and the marker commit together.
      const transitioned = await deps.db.transaction(async (tx) => {
        const org = orgScope(tx, t.orgId);
        // Serialize with lifecycle writes and recheck: a rehire after enumeration must win.
        await tx.select({ id: employees.id }).from(employees).where(org.whereId(employees, t.employeeId)).for("update");
        const [current] = await tx.select().from(tenures).where(org.whereId(tenures, t.id)).for("update");
        if (!current || current.formerTransitionAt || !current.lastWorkingDay || current.lastWorkingDay >= today)
          return false;
        const [later] = await tx
          .select({ id: tenures.id })
          .from(tenures)
          .where(
            org.where(tenures, eq(tenures.employeeId, t.employeeId), sql`${tenures.hireDate} > ${current.hireDate}`),
          )
          .limit(1);
        if (later) return false;
        await memberships.markFormer(
          { orgId: t.orgId, employeeId: t.employeeId, lastWorkingDay: t.lastWorkingDay as string },
          tx,
        );
        await tx.update(tenures).set({ formerTransitionAt: now }).where(org.whereId(tenures, t.id));
        return true;
      });
      if (transitioned) done++;
    } catch (err) {
      deps.logger.error("Former-member transition failed", { orgId: t.orgId, tenureId: t.id, error: String(err) });
      await alertOwners(deps, t, err).catch((e) =>
        deps.logger.error("Could not alert owners about a failed former transition", { error: String(e) }),
      );
    }
  }
  return done;
}

/** Tells the organisation's active owners, once per tenure, that a leaver still has access. */
async function alertOwners(deps: AppDeps, t: typeof tenures.$inferSelect, err: unknown) {
  await deps.db.transaction(async (tx) => {
    const org = orgScope(tx, t.orgId);
    await tx.select({ id: tenures.id }).from(tenures).where(org.whereId(tenures, t.id)).for("update");
    const [already] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        org.where(notifications, eq(notifications.subjectType, "former_transition"), eq(notifications.subjectId, t.id)),
      )
      .limit(1);
    if (already) return;
    const owners = await tx
      .select({ id: memberships.id })
      .from(membershipRoles)
      .innerJoin(
        memberships,
        and(eq(memberships.id, membershipRoles.membershipId), eq(memberships.orgId, membershipRoles.orgId)),
      )
      .where(org.where(membershipRoles, eq(membershipRoles.role, "owner"), eq(memberships.status, "active")));
    const [emp] = await tx
      .select({ legalName: employees.legalName, preferredName: employees.preferredName })
      .from(employees)
      .where(org.whereId(employees, t.employeeId));
    const name = emp?.preferredName || emp?.legalName || "A leaver";
    const why =
      err instanceof AppError && err.code === "last_owner"
        ? "They are the only active owner: make someone else an owner first."
        : "Check the server log for the error.";
    const title = `${name} left, but still has access to Crow HR`;
    await notify(tx, deps, {
      orgId: t.orgId,
      recipients: owners.map((o) => o.id),
      kind: "security_notice",
      title,
      body: `Their sign-in could not be made former after their last day. ${why}`,
      link: `/people/${t.employeeId}`,
      subjectType: "former_transition",
      subjectId: t.id,
      email: {
        headline: title,
        detail: `Their sign-in could not be made former after their last working day. ${why}`,
        linkPath: `/people/${t.employeeId}`,
        actionLabel: "Open their record",
      },
    });
  });
}
