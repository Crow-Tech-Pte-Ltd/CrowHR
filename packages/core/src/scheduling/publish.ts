import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { recordAudit } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import {
  type Acknowledgement,
  type PublishChange,
  publishedShifts,
  type Roster,
  rosterPublications,
  rosterShifts,
  rosters,
} from "../db/schema/scheduling.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { notify } from "../notifications/notify.ts";
import { ACK_KINDS } from "./conflicts.ts";
import { assertCanEdit, conflictsOf, eligibleEmployees, loadRoster } from "./rosters.ts";
import type { SchedulingActor } from "./templates.ts";
import { dayLabel, rangeLabel } from "./time.ts";

/** Publishing (spec "Publishing", design decision 3). */

export const publishInput = z.object({
  acknowledge: z
    .array(z.object({ shiftId: z.uuid(), kind: z.string().min(1).max(40) }))
    .max(1_000)
    .default([]),
});

type Slot = { date: string; kind: "shift" | "rest"; startsAt: Date | null; endsAt: Date | null };

const slotText = (s: Slot) =>
  s.kind === "rest" ? `${s.date} rest` : `${s.date} ${rangeLabel(s.startsAt as Date, s.endsAt as Date)}`;

/** Active memberships linked to these employees. */
export async function membershipsFor(db: Db, orgId: string, employeeIds: readonly string[]) {
  if (!employeeIds.length) return new Map<string, string>();
  const rows = await db
    .select({ id: memberships.id, employeeId: memberships.employeeId })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, orgId),
        inArray(memberships.employeeId, [...employeeIds]),
        eq(memberships.status, "active"),
      ),
    );
  return new Map(rows.map((r) => [r.employeeId as string, r.id]));
}

/** "Your shift on Wed 2 Dec 2026 changed from 09:00–17:00 to 10:00–18:00", or a summary. */
export function changeMessage(change: { before: Slot[]; after: Slot[] }, weekStart: string): string {
  // Only the dates whose shifts differ.
  const texts = (list: Slot[], date: string) =>
    list
      .filter((s) => s.date === date)
      .map(slotText)
      .join("|");
  const dates = new Set([...change.before, ...change.after].map((s) => s.date));
  const changed = new Set([...dates].filter((d) => texts(change.before, d) !== texts(change.after, d)));
  const b = change.before.filter((s) => s.kind === "shift" && changed.has(s.date));
  const a = change.after.filter((s) => s.kind === "shift" && changed.has(s.date));
  const sameDay = b.length === 1 && a.length === 1 && b[0]?.date === a[0]?.date;
  if (sameDay && b[0] && a[0]) {
    return `Your shift on ${dayLabel(a[0].date)} changed from ${rangeLabel(b[0].startsAt as Date, b[0].endsAt as Date)} to ${rangeLabel(a[0].startsAt as Date, a[0].endsAt as Date)}`;
  }
  if (b.length === 0 && a.length === 1 && a[0]) {
    return `New shift on ${dayLabel(a[0].date)}: ${rangeLabel(a[0].startsAt as Date, a[0].endsAt as Date)}`;
  }
  if (a.length === 0 && b.length === 1 && b[0]) {
    return `Your shift on ${dayLabel(b[0].date)} (${rangeLabel(b[0].startsAt as Date, b[0].endsAt as Date)}) was removed`;
  }
  return `Your schedule for the week of ${dayLabel(weekStart)} changed`;
}

export async function publishRoster(
  deps: AppDeps,
  actor: SchedulingActor,
  grant: Grant,
  rosterId: string,
  input: z.output<typeof publishInput>,
): Promise<{ roster: Roster; notified: number; changedEmployees: number }> {
  const roster = await loadRoster(deps.db, actor.orgId, rosterId);
  await assertCanEdit(
    grant,
    await eligibleEmployees(deps.db, actor.orgId, {
      weekStart: roster.weekStart,
      locationId: roster.locationId,
      departmentId: roster.departmentId,
    }),
  );
  return deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(rosters)
      .where(orgScope(tx, actor.orgId).whereId(rosters, rosterId))
      .for("update");
    if (!locked) throw new AppError("not_found", "That roster doesn't exist or you can't see it.");
    const working = await tx
      .select()
      .from(rosterShifts)
      .where(orgScope(tx, actor.orgId).where(rosterShifts, eq(rosterShifts.rosterId, rosterId)))
      .orderBy(asc(rosterShifts.date), asc(rosterShifts.startsAt));
    const { result } = await conflictsOf({ ...deps, db: tx }, actor.orgId, roster.weekStart, working);
    const required: Acknowledgement[] = [];
    for (const s of working) {
      for (const c of result.byShift.get(s.id) ?? []) {
        if (c.severity === "block") {
          throw new AppError(
            "shift_overlap",
            `A shift on ${dayLabel(s.date)} overlaps another. Fix it before publishing.`,
            {
              shiftId: s.id,
            },
          );
        }
        if (ACK_KINDS.includes(c.kind)) required.push({ shiftId: s.id, kind: c.kind });
      }
    }
    const given = new Set(input.acknowledge.map((a) => `${a.shiftId}:${a.kind}`));
    const missing = required.filter((r) => !given.has(`${r.shiftId}:${r.kind}`));
    if (missing.length) {
      throw new AppError(
        "unacknowledged_conflicts",
        `${missing.length} ${missing.length === 1 ? "shift needs" : "shifts need"} your acknowledgement before publishing: review the on-leave and not-employed shifts.`,
        {
          conflicts: missing.map((m) => {
            const s = working.find((w) => w.id === m.shiftId);
            const c = result.byShift.get(m.shiftId)?.find((x) => x.kind === m.kind);
            return {
              shiftId: m.shiftId,
              kind: m.kind,
              employeeId: s?.employeeId ?? null,
              date: s?.date ?? null,
              message: c?.message ?? "",
            };
          }),
        },
      );
    }

    const before = await tx
      .select()
      .from(publishedShifts)
      .where(orgScope(tx, actor.orgId).where(publishedShifts, eq(publishedShifts.rosterId, rosterId)));
    const now = deps.clock.now();
    const version = locked.version + 1;
    await tx
      .delete(publishedShifts)
      .where(orgScope(tx, actor.orgId).where(publishedShifts, eq(publishedShifts.rosterId, rosterId)));
    if (working.length) {
      await tx.insert(publishedShifts).values(
        working.map((w) => ({
          id: w.id,
          orgId: actor.orgId,
          rosterId,
          employeeId: w.employeeId,
          kind: w.kind,
          date: w.date,
          startsAt: w.startsAt,
          endsAt: w.endsAt,
          breakMinutes: w.breakMinutes,
          templateId: w.templateId,
          note: w.note,
          version,
          publishedAt: now,
        })),
      );
    }
    // Who changed: compare each employee's slots before and after.
    const slots = (rows: readonly Slot[] & readonly { employeeId: string | null }[], employeeId: string) =>
      (rows as (Slot & { employeeId: string | null })[])
        .filter((r) => r.employeeId === employeeId)
        .sort((x, y) => slotText(x).localeCompare(slotText(y)));
    const people = new Set([...before, ...working].map((r) => r.employeeId).filter((x): x is string => !!x));
    const changes: (PublishChange & { beforeSlots: Slot[]; afterSlots: Slot[] })[] = [];
    for (const employeeId of people) {
      const b = slots(before, employeeId);
      const a = slots(working, employeeId);
      const bt = b.map(slotText);
      const at = a.map(slotText);
      if (locked.version > 0 && JSON.stringify(bt) === JSON.stringify(at)) continue;
      if (locked.version === 0 && !a.some((s) => s.kind === "shift")) continue;
      changes.push({ employeeId, before: bt, after: at, beforeSlots: b, afterSlots: a });
    }
    await tx
      .update(rosters)
      .set({
        status: "published",
        version,
        hasChanges: false,
        publishedAt: now,
        publishedByMembershipId: actor.membershipId,
        updatedAt: now,
      })
      .where(orgScope(tx, actor.orgId).whereId(rosters, rosterId));
    await tx.insert(rosterPublications).values({
      id: deps.ids.newId(),
      orgId: actor.orgId,
      rosterId,
      version,
      publishedByMembershipId: actor.membershipId,
      acknowledged: required,
      changes: changes.map(({ employeeId, before, after }) => ({ employeeId, before, after })),
      publishedAt: now,
    });
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.roster_published",
      targetType: "roster",
      targetId: rosterId,
      meta: {
        weekStart: roster.weekStart,
        version,
        shifts: working.filter((w) => w.kind === "shift").length,
        changedEmployees: changes.length,
        acknowledged: required,
      },
    });
    const members = await membershipsFor(
      tx,
      actor.orgId,
      changes.map((c) => c.employeeId),
    );
    let notified = 0;
    for (const c of changes) {
      const recipient = members.get(c.employeeId);
      if (!recipient) continue;
      const title =
        locked.version === 0
          ? `Your schedule for the week of ${dayLabel(roster.weekStart)} is published`
          : changeMessage({ before: c.beforeSlots, after: c.afterSlots }, roster.weekStart);
      const r = await notify(tx, deps, {
        orgId: actor.orgId,
        recipients: [recipient],
        kind: "roster_published",
        title,
        link: `/schedules/me?week=${roster.weekStart}`,
        subjectType: "roster",
        subjectId: rosterId,
        email: { headline: title, linkPath: `/schedules/me?week=${roster.weekStart}` },
      });
      notified += r.inApp;
    }
    const [updated] = await tx.select().from(rosters).where(orgScope(tx, actor.orgId).whereId(rosters, rosterId));
    return { roster: updated as Roster, notified, changedEmployees: changes.length };
  });
}
