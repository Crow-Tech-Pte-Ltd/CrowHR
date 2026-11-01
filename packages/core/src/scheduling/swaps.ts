import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { type AuditContext, recordAudit, systemAuditContext } from "../audit/audit.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { employees } from "../db/schema/employees.ts";
import {
  OPEN_SWAP_STATUSES,
  publishedShifts,
  type Roster,
  rosterShifts,
  rosters,
  type ShiftSwap,
  type SwapStatus,
  shiftSwaps,
} from "../db/schema/scheduling.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayName } from "../employees/records.ts";
import { AppError } from "../errors.ts";
import { loadEmployeesTime } from "../leave/calendar.ts";
import { notify } from "../notifications/notify.ts";
import { submitApproval, withdrawSubject } from "../workflows/engine.ts";
import type { InboxSource, SubjectAdapter, Transition, WorkflowPlugin } from "../workflows/types.ts";
import { inScope } from "./feeds.ts";
import { membershipsFor } from "./publish.ts";
import { assertNoOverlap } from "./rosters.ts";
import type { SchedulingActor } from "./templates.ts";
import { dayLabel, rangeLabel } from "./time.ts";

/**
 * Shift swaps, give-aways and open-shift pickup (spec "Shift swaps and open shifts", design
 * decision 6): `pending_peer` → `pending_approval` → `approved` | `rejected`; pickup starts at
 * `pending_approval`. The approval runs through the workflows engine as subject `shift_swap`.
 */

export const swapInput = z
  .object({
    kind: z.enum(["swap", "giveaway", "pickup"]),
    shiftId: z.uuid(),
    peerEmployeeId: z.uuid().nullable().default(null),
    peerShiftId: z.uuid().nullable().default(null),
    note: z.string().trim().max(200, "Keep the note to 200 characters.").nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "pickup" && !v.peerEmployeeId) {
      ctx.addIssue({ code: "custom", path: ["peerEmployeeId"], message: "Choose the colleague." });
    }
    if (v.kind === "swap" && !v.peerShiftId) {
      ctx.addIssue({ code: "custom", path: ["peerShiftId"], message: "Choose the colleague's shift you'd take." });
    }
  });

export const swapView = z.object({
  id: z.uuid(),
  kind: z.enum(["swap", "giveaway", "pickup"]),
  status: z.enum(["pending_peer", "pending_approval", "approved", "rejected", "declined", "cancelled", "expired"]),
  direction: z.enum(["outgoing", "incoming", "other"]),
  requester: z.object({ id: z.uuid(), name: z.string() }),
  peer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  shift: z.object({ id: z.uuid(), date: z.string(), time: z.string() }),
  peerShift: z.object({ id: z.uuid(), date: z.string(), time: z.string() }).nullable(),
  note: z.string().nullable(),
  reason: z.string().nullable(),
  approvalRequestId: z.uuid().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type SwapView = z.input<typeof swapView>;

type PublishedRow = typeof publishedShifts.$inferSelect;

async function published(db: Db, orgId: string, id: string, lock = false): Promise<PublishedRow | null> {
  const q = db.select().from(publishedShifts).where(orgScope(db, orgId).whereId(publishedShifts, id));
  const [row] = lock ? await q.for("update") : await q;
  return row ?? null;
}

async function working(db: Db, orgId: string, id: string, lock = false) {
  const q = db.select().from(rosterShifts).where(orgScope(db, orgId).whereId(rosterShifts, id));
  const [row] = lock ? await q.for("update") : await q;
  return row ?? null;
}

const same = (
  a: PublishedRow,
  w: { employeeId: string | null; startsAt: Date | null; endsAt: Date | null; date: string },
) =>
  a.employeeId === w.employeeId &&
  a.date === w.date &&
  a.startsAt?.getTime() === w.startsAt?.getTime() &&
  a.endsAt?.getTime() === w.endsAt?.getTime();

async function names(db: Db, orgId: string, ids: readonly string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
    .from(employees)
    .where(orgScope(db, orgId).where(employees, inArray(employees.id, [...ids])));
  return new Map(rows.map((r) => [r.id, displayName(r)]));
}

const timeOf = (r: { startsAt: Date | null; endsAt: Date | null }) =>
  r.startsAt && r.endsAt ? rangeLabel(r.startsAt, r.endsAt) : "Rest day";

async function eligibleFor(db: Db, orgId: string, roster: Roster, employeeId: string, date: string) {
  const t = (await loadEmployeesTime(db, orgId, [employeeId])).get(employeeId);
  return !!t && inScope(t, date, roster);
}

/** Checks a swap can happen as requested: shifts published, unchanged, future, held as stated. */
async function validate(
  db: Db,
  orgId: string,
  now: Date,
  s: Pick<ShiftSwap, "kind" | "shiftId" | "requesterEmployeeId" | "peerEmployeeId" | "peerShiftId">,
  lock: boolean,
) {
  const shift = await published(db, orgId, s.shiftId, lock);
  const shiftWorking = await working(db, orgId, s.shiftId, lock);
  if (!shift || !shiftWorking || shift.kind !== "shift" || !shift.startsAt || !shift.endsAt) {
    throw new AppError("not_found", "That shift isn't on a published roster.");
  }
  if (!same(shift, shiftWorking)) {
    throw new AppError(
      "stale",
      "This shift has changed on the roster since it was published. Ask your manager to publish the roster first.",
    );
  }
  if (shift.startsAt <= now) throw new AppError("conflict", "That shift has already started, so it can't be swapped.");
  const expectedHolder = s.kind === "pickup" ? null : s.requesterEmployeeId;
  if (shift.employeeId !== expectedHolder) {
    throw new AppError(
      "stale",
      s.kind === "pickup"
        ? "Someone has already taken that open shift."
        : "That shift is no longer yours on the roster.",
    );
  }
  let peerShift: PublishedRow | null = null;
  if (s.kind === "swap") {
    peerShift = await published(db, orgId, s.peerShiftId as string, lock);
    const peerWorking = await working(db, orgId, s.peerShiftId as string, lock);
    if (!peerShift || !peerWorking || peerShift.kind !== "shift" || !peerShift.startsAt || !peerShift.endsAt) {
      throw new AppError("not_found", "Your colleague's shift isn't on a published roster.");
    }
    if (!same(peerShift, peerWorking)) {
      throw new AppError(
        "stale",
        "Your colleague's shift has changed since it was published. Ask your manager to publish the roster first.",
      );
    }
    if (peerShift.rosterId !== shift.rosterId) {
      throw new AppError("validation_failed", "Swap shifts within the same roster.", {
        issues: [{ path: "peerShiftId", message: "Pick a shift from the same roster." }],
      });
    }
    if (peerShift.employeeId !== s.peerEmployeeId)
      throw new AppError("stale", "That shift is no longer your colleague's.");
    if (peerShift.startsAt <= now) throw new AppError("conflict", "Your colleague's shift has already started.");
  }
  const roster = await orgScope(db, orgId).getById(rosters, shift.rosterId, "roster");
  // The new holders: eligible, and no overlap with their other shifts (published and working copies).
  const moves: { employeeId: string; row: PublishedRow; except: string[] }[] = [];
  const involved = [shift.id, ...(peerShift ? [peerShift.id] : [])];
  if (s.kind === "pickup") moves.push({ employeeId: s.requesterEmployeeId, row: shift, except: involved });
  else moves.push({ employeeId: s.peerEmployeeId as string, row: shift, except: involved });
  if (peerShift) moves.push({ employeeId: s.requesterEmployeeId, row: peerShift, except: involved });
  for (const m of moves) {
    if (!(await eligibleFor(db, orgId, roster, m.employeeId, m.row.date))) {
      const n = (await names(db, orgId, [m.employeeId])).get(m.employeeId) ?? "That colleague";
      throw new AppError("not_eligible", `${n} isn't on this roster on ${dayLabel(m.row.date)}.`);
    }
    await assertNoOverlap(db, orgId, m.employeeId, m.row.startsAt, m.row.endsAt, m.except, publishedShifts);
    await assertNoOverlap(db, orgId, m.employeeId, m.row.startsAt, m.row.endsAt, m.except, rosterShifts);
  }
  return { shift, peerShift, roster, moves };
}

async function loadSwap(db: Db, orgId: string, id: string, lock = false): Promise<ShiftSwap> {
  const q = db.select().from(shiftSwaps).where(orgScope(db, orgId).whereId(shiftSwaps, id));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new AppError("not_found", "That swap request doesn't exist or you can't see it.");
  return row;
}

async function setStatus(
  db: Db,
  deps: AppDeps,
  orgId: string,
  id: string,
  status: SwapStatus,
  reason: string | null = null,
) {
  const now = deps.clock.now();
  await db
    .update(shiftSwaps)
    .set({ status, reason, decidedAt: now, updatedAt: now })
    .where(orgScope(db, orgId).whereId(shiftSwaps, id));
}

function kindNoun(kind: ShiftSwap["kind"]) {
  return kind === "swap" ? "shift swap" : kind === "giveaway" ? "shift give-away" : "open shift pickup";
}

async function submit(db: Db, deps: AppDeps, audit: AuditContext, swap: ShiftSwap) {
  // The colleague who takes or trades the shift benefits from it, so they never decide it, even
  // when they are the requester's manager (review #19). The engine honours this through
  // resolution, escalation, delegation, reassignment and the decision itself.
  const peer = swap.peerEmployeeId
    ? (await membershipsFor(db, swap.orgId, [swap.peerEmployeeId])).get(swap.peerEmployeeId)
    : undefined;
  const r = await submitApproval(db, deps, audit, {
    orgId: swap.orgId,
    subjectType: "shift_swap",
    subjectId: swap.id,
    requesterMembershipId: swap.createdByMembershipId,
    requesterEmployeeId: swap.requesterEmployeeId,
    attributes: { typeCode: swap.kind },
    excludedDeciderMembershipIds: peer ? [peer] : [],
  });
  await db
    .update(shiftSwaps)
    .set({ status: "pending_approval", approvalRequestId: r.requestId, updatedAt: deps.clock.now() })
    .where(orgScope(db, swap.orgId).whereId(shiftSwaps, swap.id));
}

export async function requestSwap(
  deps: AppDeps,
  actor: SchedulingActor,
  input: z.output<typeof swapInput>,
): Promise<ShiftSwap> {
  const requester = actor.employeeId;
  if (!requester) {
    throw new AppError("forbidden", "Your sign-in isn't linked to an employee record, so you have no shifts to swap.");
  }
  if (input.peerEmployeeId === requester) {
    throw new AppError("validation_failed", "Pick a colleague, not yourself.", {
      issues: [{ path: "peerEmployeeId", message: "Choose someone else on the roster." }],
    });
  }
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const base = {
      kind: input.kind,
      shiftId: input.shiftId,
      requesterEmployeeId: requester,
      peerEmployeeId: input.kind === "pickup" ? null : input.peerEmployeeId,
      peerShiftId: input.kind === "swap" ? input.peerShiftId : null,
    };
    const v = await validate(tx, actor.orgId, now, base, true);
    if (base.peerEmployeeId && !(await membershipsFor(tx, actor.orgId, [base.peerEmployeeId])).size) {
      throw new AppError(
        "not_eligible",
        "That colleague can't sign in to Crow HR yet, so they can't accept. Ask your manager.",
      );
    }
    const open = await tx
      .select({ id: shiftSwaps.id })
      .from(shiftSwaps)
      .where(
        orgScope(tx, actor.orgId).where(
          shiftSwaps,
          inArray(shiftSwaps.status, [...OPEN_SWAP_STATUSES]),
          or(
            inArray(shiftSwaps.shiftId, [v.shift.id, ...(v.peerShift ? [v.peerShift.id] : [])]),
            inArray(shiftSwaps.peerShiftId, [v.shift.id, ...(v.peerShift ? [v.peerShift.id] : [])]),
          ),
        ),
      );
    if (open.length) throw new AppError("conflict", "There's already an open swap request for this shift.");
    const starts = [v.shift.startsAt as Date, ...(v.peerShift?.startsAt ? [v.peerShift.startsAt] : [])];
    const expiresAt = new Date(Math.min(...starts.map((d) => d.getTime())));
    const [row] = await tx
      .insert(shiftSwaps)
      .values({
        id: deps.ids.newId(),
        orgId: actor.orgId,
        rosterId: v.shift.rosterId,
        ...base,
        status: input.kind === "pickup" ? "pending_approval" : "pending_peer",
        note: input.note,
        createdByMembershipId: actor.membershipId,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const swap = row as ShiftSwap;
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.swap_requested",
      targetType: "shift_swap",
      targetId: swap.id,
      meta: { kind: swap.kind, shiftId: swap.shiftId, peerShiftId: swap.peerShiftId },
    });
    if (swap.kind === "pickup") {
      await submit(tx, deps, actor.audit, swap);
    } else {
      const who = (await names(tx, actor.orgId, [requester])).get(requester) ?? "A colleague";
      const recipient = (await membershipsFor(tx, actor.orgId, [swap.peerEmployeeId as string])).get(
        swap.peerEmployeeId as string,
      );
      const title =
        swap.kind === "swap"
          ? `${who} asked to swap shifts with you: their ${dayLabel(v.shift.date)} for your ${dayLabel(v.peerShift?.date as string)}`
          : `${who} offered you their shift on ${dayLabel(v.shift.date)} (${timeOf(v.shift)})`;
      await notify(tx, deps, {
        orgId: actor.orgId,
        recipients: recipient ? [recipient] : [],
        kind: "acknowledgement_requested",
        title,
        link: "/schedules/me",
        subjectType: "shift_swap",
        subjectId: swap.id,
        email: { headline: title, linkPath: "/schedules/me", actionLabel: "Accept or decline" },
      });
    }
    return loadSwap(tx, actor.orgId, swap.id);
  });
}

/** The colleague accepts (→ approval) or declines. */
export async function answerSwap(deps: AppDeps, actor: SchedulingActor, id: string, accept: boolean) {
  return deps.db.transaction(async (tx) => {
    const swap = await loadSwap(tx, actor.orgId, id, true);
    if (!actor.employeeId || swap.peerEmployeeId !== actor.employeeId) {
      throw new AppError("not_found", "That swap request doesn't exist or isn't addressed to you.");
    }
    if (swap.status !== "pending_peer") {
      throw new AppError("conflict", `This request is already ${swap.status.replace("_", " ")}. Nothing was changed.`);
    }
    if (swap.expiresAt <= deps.clock.now()) {
      await setStatus(tx, deps, actor.orgId, id, "expired");
      throw new AppError("conflict", "The shift has started, so this request expired.");
    }
    if (accept) {
      await validate(tx, actor.orgId, deps.clock.now(), swap, true);
      await submit(tx, deps, actor.audit, swap);
    } else {
      await setStatus(tx, deps, actor.orgId, id, "declined");
      const recipient = (await membershipsFor(tx, actor.orgId, [swap.requesterEmployeeId])).get(
        swap.requesterEmployeeId,
      );
      const who = (await names(tx, actor.orgId, [actor.employeeId])).get(actor.employeeId) ?? "Your colleague";
      await notify(tx, deps, {
        orgId: actor.orgId,
        recipients: recipient ? [recipient] : [],
        kind: "request_rejected",
        title: `${who} declined your ${kindNoun(swap.kind)}`,
        link: "/schedules/me",
        subjectType: "shift_swap",
        subjectId: swap.id,
      });
    }
    await recordAudit(tx, deps, actor.audit, {
      action: accept ? "scheduling.swap_accepted" : "scheduling.swap_declined",
      targetType: "shift_swap",
      targetId: id,
    });
    return loadSwap(tx, actor.orgId, id);
  });
}

/** The requester cancels before approval. */
export async function cancelSwap(deps: AppDeps, actor: SchedulingActor, id: string) {
  return deps.db.transaction(async (tx) => {
    const swap = await loadSwap(tx, actor.orgId, id, true);
    if (!actor.employeeId || swap.requesterEmployeeId !== actor.employeeId) {
      throw new AppError("not_found", "That swap request doesn't exist or isn't yours.");
    }
    if (!OPEN_SWAP_STATUSES.includes(swap.status)) {
      throw new AppError("conflict", `This request is already ${swap.status.replace("_", " ")}. Nothing was changed.`);
    }
    await setStatus(tx, deps, actor.orgId, id, "cancelled", "Cancelled by the requester.");
    if (swap.status === "pending_approval") {
      await withdrawSubject(tx, deps, actor.audit, { orgId: actor.orgId, subjectType: "shift_swap", subjectId: id });
    }
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.swap_cancelled",
      targetType: "shift_swap",
      targetId: id,
    });
    return loadSwap(tx, actor.orgId, id);
  });
}

export async function toSwapViews(db: Db, orgId: string, rows: readonly ShiftSwap[], viewer: string | null) {
  const ids = [
    ...new Set(rows.flatMap((r) => [r.requesterEmployeeId, r.peerEmployeeId]).filter((x): x is string => !!x)),
  ];
  const n = await names(db, orgId, ids);
  const shiftIds = [...new Set(rows.flatMap((r) => [r.shiftId, r.peerShiftId]).filter((x): x is string => !!x))];
  const shifts = shiftIds.length
    ? await db
        .select()
        .from(rosterShifts)
        .where(orgScope(db, orgId).where(rosterShifts, inArray(rosterShifts.id, shiftIds)))
    : [];
  const s = new Map(shifts.map((x) => [x.id, x]));
  const brief = (id: string) => {
    const x = s.get(id);
    return { id, date: x?.date ?? "", time: x ? timeOf(x) : "" };
  };
  return rows.map(
    (r): SwapView => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      direction: r.requesterEmployeeId === viewer ? "outgoing" : r.peerEmployeeId === viewer ? "incoming" : "other",
      requester: { id: r.requesterEmployeeId, name: n.get(r.requesterEmployeeId) ?? "" },
      peer: r.peerEmployeeId ? { id: r.peerEmployeeId, name: n.get(r.peerEmployeeId) ?? "" } : null,
      shift: brief(r.shiftId),
      peerShift: r.peerShiftId ? brief(r.peerShiftId) : null,
      note: r.note,
      reason: r.reason,
      approvalRequestId: r.approvalRequestId,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }),
  );
}

/** The caller's swaps (as requester or colleague), newest first. */
export async function mySwaps(db: Db, orgId: string, employeeId: string) {
  const rows = await db
    .select()
    .from(shiftSwaps)
    .where(
      orgScope(db, orgId).where(
        shiftSwaps,
        or(eq(shiftSwaps.requesterEmployeeId, employeeId), eq(shiftSwaps.peerEmployeeId, employeeId)),
      ),
    )
    .orderBy(desc(shiftSwaps.createdAt))
    .limit(50);
  return toSwapViews(db, orgId, rows, employeeId);
}

// ---------------------------------------------------------------------------------------------
// Workflows: the `shift_swap` subject, the Home item for the colleague, expiry on tick
// ---------------------------------------------------------------------------------------------

const attributes = z.object({ typeCode: z.enum(["swap", "giveaway", "pickup"]) });
type Attrs = z.output<typeof attributes>;

export function shiftSwapAdapter(deps: AppDeps): SubjectAdapter<Attrs> {
  return {
    type: "shift_swap",
    label: "Shift swap",
    inlineDecision: true,
    attributes,
    defaultSteps: [{ approverRule: "manager", escalateAfterDays: 2 }],
    /** Nobody whose shifts move decides the move (by employee record, whatever their sign-in). */
    async canDecide(db, decider, ref) {
      if (!decider.employeeId) return true;
      const swap = await loadSwap(db, ref.orgId, ref.subjectId);
      return decider.employeeId !== swap.requesterEmployeeId && decider.employeeId !== swap.peerEmployeeId;
    },
    async summary(db, ref) {
      const swap = await loadSwap(db, ref.orgId, ref.subjectId);
      const [v] = await toSwapViews(db, ref.orgId, [swap], null);
      if (!v) throw new Error("swap view missing");
      const lines = [{ label: "Requested by", value: v.requester.name }];
      if (v.kind === "swap") {
        lines.push(
          { label: `${v.requester.name} gives`, value: `${dayLabel(v.shift.date)}, ${v.shift.time}` },
          { label: `${v.peer?.name} gives`, value: `${dayLabel(v.peerShift?.date ?? "")}, ${v.peerShift?.time}` },
        );
      } else if (v.kind === "giveaway") {
        lines.push(
          { label: "Shift", value: `${dayLabel(v.shift.date)}, ${v.shift.time}` },
          { label: "Goes to", value: `${v.peer?.name} (accepted)` },
        );
      } else {
        lines.push({ label: "Open shift", value: `${dayLabel(v.shift.date)}, ${v.shift.time}` });
      }
      if (v.note) lines.push({ label: "Note", value: v.note });
      const title =
        v.kind === "swap"
          ? `Shift swap, ${dayLabel(v.shift.date).slice(0, -5)} ↔ ${dayLabel(v.peerShift?.date ?? "").slice(0, -5)}`
          : v.kind === "giveaway"
            ? `Shift give-away, ${dayLabel(v.shift.date).slice(0, -5)}`
            : `Open shift pickup, ${dayLabel(v.shift.date).slice(0, -5)}`;
      return {
        title,
        lines,
        context: [{ label: "Checked again on approval", value: "Overlaps and roster eligibility" }],
      };
    },
    async onApproved(db, ref, decision) {
      const swap = await loadSwap(db, ref.orgId, ref.subjectId, true);
      if (swap.status !== "pending_approval") {
        throw new AppError("conflict", `This request is already ${swap.status.replace("_", " ")}.`);
      }
      // Re-checked in the decision's transaction (rows locked): a failure rolls the decision back.
      const v = await validate(db, ref.orgId, decision.decidedAt, swap, true);
      const now = decision.decidedAt;
      const [roster] = await db
        .select()
        .from(rosters)
        .where(orgScope(db, ref.orgId).whereId(rosters, v.roster.id))
        .for("update");
      const version = (roster?.version ?? 0) + 1;
      for (const m of v.moves) {
        await db
          .update(rosterShifts)
          .set({ employeeId: m.employeeId, updatedAt: now })
          .where(orgScope(db, ref.orgId).whereId(rosterShifts, m.row.id));
        await db
          .update(publishedShifts)
          .set({ employeeId: m.employeeId, version, publishedAt: now })
          .where(orgScope(db, ref.orgId).whereId(publishedShifts, m.row.id));
      }
      await db
        .update(rosters)
        .set({ version, updatedAt: now })
        .where(orgScope(db, ref.orgId).whereId(rosters, v.roster.id));
      await setStatus(db, deps, ref.orgId, swap.id, "approved");
      await recordAudit(db, deps, systemAuditContext(ref.orgId, "system", "shift swap approval"), {
        action: "scheduling.swap_approved",
        targetType: "shift_swap",
        targetId: swap.id,
        meta: { kind: swap.kind, version, moves: v.moves.map((m) => ({ shiftId: m.row.id, to: m.employeeId })) },
      });
      if (swap.peerEmployeeId) {
        const recipient = (await membershipsFor(db, ref.orgId, [swap.peerEmployeeId])).get(swap.peerEmployeeId);
        const title =
          swap.kind === "swap"
            ? `Shift swap approved: you now work ${dayLabel(v.shift.date)}, ${timeOf(v.shift)}`
            : `Shift give-away approved: you now work ${dayLabel(v.shift.date)}, ${timeOf(v.shift)}`;
        await notify(db, deps, {
          orgId: ref.orgId,
          recipients: recipient ? [recipient] : [],
          kind: "roster_published",
          title,
          link: "/schedules/me",
          subjectType: "shift_swap",
          subjectId: swap.id,
          email: { headline: title, linkPath: "/schedules/me" },
        });
      }
    },
    async onRejected(db, ref) {
      const swap = await loadSwap(db, ref.orgId, ref.subjectId, true);
      await setStatus(db, deps, ref.orgId, swap.id, "rejected");
      if (swap.peerEmployeeId) {
        const recipient = (await membershipsFor(db, ref.orgId, [swap.peerEmployeeId])).get(swap.peerEmployeeId);
        await notify(db, deps, {
          orgId: ref.orgId,
          recipients: recipient ? [recipient] : [],
          kind: "request_rejected",
          title: `The ${kindNoun(swap.kind)} you accepted was not approved`,
          link: "/schedules/me",
          subjectType: "shift_swap",
          subjectId: swap.id,
        });
      }
    },
    async onWithdrawn(db, ref) {
      const swap = await loadSwap(db, ref.orgId, ref.subjectId, true);
      if (OPEN_SWAP_STATUSES.includes(swap.status)) await setStatus(db, deps, ref.orgId, swap.id, "cancelled");
    },
    async canRead(db, viewer, ref) {
      const swap = await loadSwap(db, ref.orgId, ref.subjectId);
      return !!viewer.employeeId && swap.peerEmployeeId === viewer.employeeId;
    },
    link: () => "/schedules/me",
  };
}

/** Home: swap offers waiting for the colleague's answer. */
export function swapOffersInbox(): InboxSource {
  return {
    id: "shift_swap_offers",
    label: "Shift swap offers",
    status: async () => "ready",
    async list(db, ctx) {
      if (!ctx.employeeId) return [];
      const rows = await db
        .select()
        .from(shiftSwaps)
        .where(
          orgScope(db, ctx.orgId).where(
            shiftSwaps,
            eq(shiftSwaps.peerEmployeeId, ctx.employeeId),
            eq(shiftSwaps.status, "pending_peer"),
            gte(shiftSwaps.expiresAt, ctx.now),
          ),
        )
        .orderBy(asc(shiftSwaps.expiresAt));
      const views = await toSwapViews(db, ctx.orgId, rows, ctx.employeeId);
      return views.map((v) => ({
        id: `shift_swap:${v.id}`,
        source: "shift_swap_offers",
        kind: "shift_swap_offer",
        title:
          v.kind === "swap"
            ? `Swap your ${dayLabel(v.peerShift?.date ?? "").slice(0, -5)} for ${v.requester.name}'s ${dayLabel(v.shift.date).slice(0, -5)}?`
            : `Take ${v.requester.name}'s shift on ${dayLabel(v.shift.date).slice(0, -5)}?`,
        concerns: v.requester.name,
        detail: v.kind === "swap" ? `${v.shift.time} for ${v.peerShift?.time}` : v.shift.time,
        dueOn: v.shift.date,
        createdAt: v.createdAt,
        href: "/schedules/me",
        actionLabel: "Answer",
        task: null,
      }));
    },
  };
}

/** Open requests expire when the earlier shift starts. */
export function swapExpiryTransition(deps: AppDeps): Transition {
  return {
    id: "scheduling.swap_expiry",
    async run(db, { now, audit }) {
      const due = await db
        .select()
        .from(shiftSwaps)
        .where(and(inArray(shiftSwaps.status, [...OPEN_SWAP_STATUSES]), lte(shiftSwaps.expiresAt, now)))
        .for("update", { skipLocked: true });
      for (const s of due) {
        await setStatus(db, deps, s.orgId, s.id, "expired", "The shift started before the request was decided.");
        if (s.status === "pending_approval") {
          await withdrawSubject(db, deps, audit(s.orgId), {
            orgId: s.orgId,
            subjectType: "shift_swap",
            subjectId: s.id,
          });
        }
      }
      return due.length;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Leave approved after publishing (design decision 5): tell the roster's editors
// ---------------------------------------------------------------------------------------------

/** Called by the leave adapter in the approval's transaction. */
export async function onLeaveApproved(
  db: Db,
  deps: AppDeps,
  input: { orgId: string; employeeId: string; dates: readonly string[] },
): Promise<number> {
  if (!input.dates.length) return 0;
  const from = [...input.dates].sort()[0] as string;
  const to = [...input.dates].sort().at(-1) as string;
  const hits = await db
    .select({ shift: publishedShifts, roster: rosters })
    .from(publishedShifts)
    .innerJoin(rosters, and(eq(rosters.orgId, publishedShifts.orgId), eq(rosters.id, publishedShifts.rosterId)))
    .where(
      orgScope(db, input.orgId).where(
        publishedShifts,
        eq(publishedShifts.employeeId, input.employeeId),
        eq(publishedShifts.kind, "shift"),
        gte(publishedShifts.date, from),
        lte(publishedShifts.date, to),
      ),
    );
  const affected = hits.filter((h) => input.dates.includes(h.shift.date));
  if (!affected.length) return 0;
  const name = (await names(db, input.orgId, [input.employeeId])).get(input.employeeId) ?? "An employee";
  const admins = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(
      membershipRoles,
      and(eq(membershipRoles.orgId, memberships.orgId), eq(membershipRoles.membershipId, memberships.id)),
    )
    .where(
      and(eq(memberships.orgId, input.orgId), eq(memberships.status, "active"), eq(membershipRoles.role, "hr_admin")),
    );
  const hr = admins.map((m) => m.id);
  for (const rosterId of new Set(affected.map((a) => a.roster.id))) {
    const mine = affected.filter((a) => a.roster.id === rosterId);
    const roster = mine[0]?.roster as Roster;
    const recipients = [
      ...new Set([...(roster.publishedByMembershipId ? [roster.publishedByMembershipId] : []), ...hr]),
    ];
    const dates = mine.map((m) => dayLabel(m.shift.date).slice(0, -5)).join(", ");
    await notify(db, deps, {
      orgId: input.orgId,
      recipients,
      kind: "roster_published",
      title: `${name}'s approved leave overlaps ${mine.length === 1 ? "a published shift" : `${mine.length} published shifts`} (${dates})`,
      body: "Reassign the shifts or mark them open, then publish the roster again.",
      link: `/schedules?week=${roster.weekStart}`,
      subjectType: "roster",
      subjectId: rosterId,
    });
  }
  return affected.length;
}

export function schedulingWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return {
    name: "scheduling",
    subjects: [shiftSwapAdapter(deps)],
    inbox: [swapOffersInbox()],
    transitions: [swapExpiryTransition(deps)],
  };
}
