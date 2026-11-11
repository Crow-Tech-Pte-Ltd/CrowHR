import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { loadAttendanceSettings } from "../attendance/settings.ts";
import { recordAudit } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { employees, employmentRecords } from "../db/schema/employees.ts";
import { departments, locations } from "../db/schema/organisation.ts";
import {
  OPEN_SWAP_STATUSES,
  publishedShifts,
  type Roster,
  type RosterShift,
  rosterShifts,
  rosters,
  type ShiftColour,
  shiftSwaps,
  shiftTemplates,
} from "../db/schema/scheduling.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { addDays, isIsoDate } from "../employees/dates.ts";
import { displayName } from "../employees/records.ts";
import { AppError } from "../errors.ts";
import { type EmployeeTime, loadEmployeesTime, scheduleOn, tenureOn } from "../leave/calendar.ts";
import { leaveCalendar } from "../leave/outputs.ts";
import { holidaysBetween } from "../leave/views.ts";
import { notify } from "../notifications/notify.ts";
import { withdrawSubject } from "../workflows/engine.ts";
import { type Conflict, computeConflicts, type ShiftLike } from "./conflicts.ts";
import { inScope } from "./feeds.ts";
import type { SchedulingActor } from "./templates.ts";
import { dayLabel, HHMM, isMonday, mondayOf, paidMinutes, sgTime, shiftInstants, weekDates } from "./time.ts";

/** Rosters and shifts (spec "Rosters and assignments"; design decisions 1–3). */

export const MAX_ROSTER_EMPLOYEES = 150;

export interface RosterRef {
  weekStart: string;
  locationId: string | null;
  departmentId: string | null;
}

export const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-11-02." });

export const rosterRefSchema = z
  .object({
    weekStart: isoDate.refine(isMonday, { message: "Rosters start on a Monday. Pick the Monday of the week." }),
    locationId: z.uuid().nullable().default(null),
    departmentId: z.uuid().nullable().default(null),
  })
  .refine((r) => r.locationId || r.departmentId, {
    message: "Choose a location or a department for the roster.",
    path: ["locationId"],
  });

export function scopeKey(ref: Pick<RosterRef, "locationId" | "departmentId">): string {
  return `${ref.locationId ?? "*"}:${ref.departmentId ?? "*"}`;
}

export async function findRoster(db: Db, orgId: string, ref: RosterRef): Promise<Roster | null> {
  const [row] = await db
    .select()
    .from(rosters)
    .where(
      orgScope(db, orgId).where(rosters, eq(rosters.scopeKey, scopeKey(ref)), eq(rosters.weekStart, ref.weekStart)),
    );
  return row ?? null;
}

/** Employees in the roster's scope on at least one day of its week. */
export async function eligibleEmployees(db: Db, orgId: string, ref: RosterRef): Promise<Map<string, EmployeeTime>> {
  const sunday = addDays(ref.weekStart, 6);
  const rows = await db
    .selectDistinct({ id: employmentRecords.employeeId })
    .from(employmentRecords)
    .where(
      orgScope(db, orgId).where(
        employmentRecords,
        lte(employmentRecords.effectiveFrom, sunday),
        or(isNull(employmentRecords.effectiveTo), gt(employmentRecords.effectiveTo, ref.weekStart)),
        ref.locationId ? eq(employmentRecords.locationId, ref.locationId) : undefined,
        ref.departmentId ? eq(employmentRecords.departmentId, ref.departmentId) : undefined,
      ),
    );
  const times = await loadEmployeesTime(
    db,
    orgId,
    rows.map((r) => r.id),
  );
  const dates = weekDates(ref.weekStart);
  for (const [id, t] of times) if (!dates.some((d) => inScope(t, d, ref))) times.delete(id);
  return times;
}

/** Edit rights on a roster: all, or a manager with at least one eligible team member. */
export async function assertCanEdit(grant: Grant, eligible: ReadonlyMap<string, unknown>): Promise<void> {
  if (grant.all) return;
  const mine = await grant.employeeIds();
  if (![...eligible.keys()].some((id) => mine.has(id))) {
    throw new AppError("not_found", "That roster doesn't exist or you can't edit it: none of your team works there.");
  }
}

async function scopeLabel(db: Db, orgId: string, ref: Pick<RosterRef, "locationId" | "departmentId">) {
  const org = orgScope(db, orgId);
  const parts: string[] = [];
  if (ref.locationId) parts.push((await org.getById(locations, ref.locationId, "location")).name);
  if (ref.departmentId) parts.push((await org.getById(departments, ref.departmentId, "department")).name);
  return parts.join(" · ");
}

export async function ensureRoster(
  deps: AppDeps,
  actor: SchedulingActor,
  grant: Grant,
  ref: RosterRef,
): Promise<Roster> {
  await scopeLabel(deps.db, actor.orgId, ref); // 404 for unknown or foreign scope ids
  const eligible = await eligibleEmployees(deps.db, actor.orgId, ref);
  await assertCanEdit(grant, eligible);
  const found = await findRoster(deps.db, actor.orgId, ref);
  if (found) return found;
  const id = deps.ids.newId();
  await deps.db
    .insert(rosters)
    .values({
      id,
      orgId: actor.orgId,
      locationId: ref.locationId,
      departmentId: ref.departmentId,
      scopeKey: scopeKey(ref),
      weekStart: ref.weekStart,
      createdByMembershipId: actor.membershipId,
    })
    .onConflictDoNothing();
  return (await findRoster(deps.db, actor.orgId, ref)) as Roster;
}

export async function loadRoster(db: Db, orgId: string, id: string): Promise<Roster> {
  return orgScope(db, orgId).getById(rosters, id, "roster");
}

const refOf = (r: Roster): RosterRef => ({
  weekStart: r.weekStart,
  locationId: r.locationId,
  departmentId: r.departmentId,
});

// ---------------------------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------------------------

export interface ShiftView {
  id: string;
  employeeId: string | null;
  kind: "shift" | "rest";
  date: string;
  startsAt: string | null;
  endsAt: string | null;
  start: string | null;
  end: string | null;
  breakMinutes: number;
  paidMinutes: number;
  templateId: string | null;
  templateCode: string | null;
  colour: ShiftColour;
  note: string | null;
  updatedAt: string;
  conflicts: Conflict[];
  /** An open swap or pickup request on this shift. */
  pendingSwap: boolean;
}

export interface RosterView {
  roster: {
    id: string | null;
    weekStart: string;
    locationId: string | null;
    departmentId: string | null;
    scopeLabel: string;
    status: "none" | "draft" | "published";
    version: number;
    hasChanges: boolean;
    publishedAt: string | null;
  };
  mode: "edit" | "published";
  canEdit: boolean;
  days: { date: string; holiday: string | null; minutes: number }[];
  employees: {
    id: string;
    name: string;
    employeeNumber: string;
    schedule: "fixed" | "shift" | null;
    editable: boolean;
    minutes: number;
    restDayAssumed: string | null;
    warnings: Conflict[];
  }[];
  shifts: ShiftView[];
  /** Conflicts that must be acknowledged to publish. */
  toAcknowledge: { shiftId: string; kind: string; employeeName: string; date: string; message: string }[];
}

type Row = Pick<
  RosterShift,
  "id" | "rosterId" | "employeeId" | "kind" | "date" | "startsAt" | "endsAt" | "breakMinutes" | "templateId" | "note"
> & { updatedAt?: Date };

async function employeeFacts(db: Db, orgId: string, ids: readonly string[]) {
  if (!ids.length) return new Map<string, { name: string; number: string }>();
  const rows = await db
    .select({
      id: employees.id,
      legalName: employees.legalName,
      preferredName: employees.preferredName,
      employeeNumber: employees.employeeNumber,
    })
    .from(employees)
    .where(orgScope(db, orgId).where(employees, inArray(employees.id, [...ids])));
  return new Map(rows.map((r) => [r.id, { name: displayName(r), number: r.employeeNumber }]));
}

/** Working-copy rows of these employees over the months the week touches (any roster). */
async function contextRows(db: Db, orgId: string, employeeIds: readonly string[], weekStart: string) {
  if (!employeeIds.length) return [];
  const from = mondayOf(`${weekStart.slice(0, 7)}-01`);
  const sunday = addDays(weekStart, 6);
  const [y, m] = sunday.slice(0, 7).split("-").map(Number) as [number, number];
  const monthEnd = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
  return db
    .select()
    .from(rosterShifts)
    .where(
      orgScope(db, orgId).where(
        rosterShifts,
        inArray(rosterShifts.employeeId, [...employeeIds]),
        gte(rosterShifts.date, from),
        lte(rosterShifts.date, addDays(mondayOf(monthEnd), 6)),
      ),
    );
}

export async function conflictsOf(deps: AppDeps, orgId: string, weekStart: string, rows: readonly Row[]) {
  const ids = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => !!x))];
  const times = await loadEmployeesTime(deps.db, orgId, ids);
  const context = (await contextRows(deps.db, orgId, ids, weekStart)) as ShiftLike[];
  const settings = await loadAttendanceSettings(deps.db, orgId);
  const leave = await leaveCalendar(deps).entries(orgId, ids, weekStart, addDays(weekStart, 6));
  return {
    times,
    result: computeConflicts({
      shifts: rows as readonly ShiftLike[],
      context,
      times,
      leave,
      weekStart,
      startTimeFor: (employeeId, date) => {
        const t = times.get(employeeId);
        const s = t ? scheduleOn(t, date) : null;
        return (s && settings.scheduleStartTimes[s.schedule.id]) || settings.defaultStartTime;
      },
    }),
  };
}

export async function buildRosterView(
  deps: AppDeps,
  orgId: string,
  ref: RosterRef,
  opts: { mode: "edit" | "published"; editableIds: ReadonlySet<string> | "all" | null },
): Promise<RosterView> {
  const db = deps.db;
  const label = await scopeLabel(db, orgId, ref);
  const roster = await findRoster(db, orgId, ref);
  const eligible = await eligibleEmployees(db, orgId, ref);
  const table = opts.mode === "edit" ? rosterShifts : publishedShifts;
  const rows: Row[] = roster
    ? ((await db
        .select()
        .from(table)
        .where(orgScope(db, orgId).where(table, eq(table.rosterId, roster.id)))
        .orderBy(asc(table.date), asc(table.startsAt))) as Row[])
    : [];
  const employeeIds = [
    ...new Set([...eligible.keys(), ...rows.map((r) => r.employeeId).filter((x): x is string => !!x)]),
  ];
  const facts = await employeeFacts(db, orgId, employeeIds);
  const conflicts = opts.mode === "edit" ? await conflictsOf(deps, orgId, ref.weekStart, rows) : null;
  const times = conflicts?.times ?? (await loadEmployeesTime(db, orgId, employeeIds));
  for (const [id, t] of eligible) if (!times.has(id)) times.set(id, t);
  const templates = await db
    .select({ id: shiftTemplates.id, code: shiftTemplates.code, colour: shiftTemplates.colour })
    .from(shiftTemplates)
    .where(orgScope(db, orgId).where(shiftTemplates));
  const tpl = new Map(templates.map((t) => [t.id, t]));
  const swaps = roster
    ? await db
        .select({ shiftId: shiftSwaps.shiftId, peerShiftId: shiftSwaps.peerShiftId })
        .from(shiftSwaps)
        .where(
          orgScope(db, orgId).where(
            shiftSwaps,
            eq(shiftSwaps.rosterId, roster.id),
            inArray(shiftSwaps.status, [...OPEN_SWAP_STATUSES]),
          ),
        )
    : [];
  const swapping = new Set(swaps.flatMap((s) => [s.shiftId, s.peerShiftId]).filter(Boolean));
  const shifts: ShiftView[] = rows.map((r) => {
    const t = r.templateId ? tpl.get(r.templateId) : undefined;
    return {
      id: r.id,
      employeeId: r.employeeId,
      kind: r.kind,
      date: r.date,
      startsAt: r.startsAt?.toISOString() ?? null,
      endsAt: r.endsAt?.toISOString() ?? null,
      start: r.startsAt ? sgTime(r.startsAt) : null,
      end: r.endsAt ? sgTime(r.endsAt) : null,
      breakMinutes: r.breakMinutes,
      paidMinutes: r.startsAt && r.endsAt ? paidMinutes(r.startsAt, r.endsAt, r.breakMinutes) : 0,
      templateId: r.templateId,
      templateCode: t?.code ?? null,
      colour: t?.colour ?? "plain",
      note: r.note,
      updatedAt: (r.updatedAt ?? new Date(0)).toISOString(),
      conflicts: conflicts?.result.byShift.get(r.id) ?? [],
      pendingSwap: swapping.has(r.id),
    };
  });
  const holidays = await holidaysBetween(db, orgId, ref.weekStart, addDays(ref.weekStart, 6));
  const days = weekDates(ref.weekStart).map((date) => ({
    date,
    holiday: holidays.find((h) => h.date === date)?.name ?? null,
    minutes: shifts.filter((s) => s.date === date && s.employeeId).reduce((n, s) => n + s.paidMinutes, 0),
  }));
  const editable = (id: string) => opts.editableIds === "all" || !!opts.editableIds?.has(id);
  // A team-scoped manager sees colleagues outside their team by name and shift times only: their
  // leave (conflicts), hour warnings and employee numbers stay with HR (review: roster leaks).
  const visible = (id: string | null) => !id || opts.editableIds === "all" || !!opts.editableIds?.has(id);
  for (const s of shifts) if (!visible(s.employeeId)) s.conflicts = [];
  const list = employeeIds
    .map((id) => {
      const t = times.get(id);
      const s = t ? scheduleOn(t, ref.weekStart) : null;
      const mine = visible(id);
      return {
        id,
        name: facts.get(id)?.name ?? "",
        employeeNumber: mine ? (facts.get(id)?.number ?? "") : "",
        schedule: s ? (s.version.days ? ("fixed" as const) : ("shift" as const)) : null,
        editable: opts.mode === "edit" && editable(id),
        minutes: shifts.filter((x) => x.employeeId === id).reduce((n, x) => n + x.paidMinutes, 0),
        restDayAssumed: mine ? (conflicts?.result.assumedRestDay.get(id) ?? null) : null,
        warnings: mine ? (conflicts?.result.byEmployee.get(id) ?? []) : [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(list.map((e) => [e.id, e.name]));
  const toAcknowledge = shifts.flatMap((s) =>
    s.conflicts
      .filter((c) => c.severity === "ack")
      .map((c) => ({
        shiftId: s.id,
        kind: c.kind,
        employeeName: names.get(s.employeeId ?? "") ?? "",
        date: s.date,
        message: c.message,
      })),
  );
  return {
    roster: {
      id: roster?.id ?? null,
      weekStart: ref.weekStart,
      locationId: ref.locationId,
      departmentId: ref.departmentId,
      scopeLabel: label,
      status: roster ? roster.status : "none",
      version: roster?.version ?? 0,
      hasChanges: roster?.hasChanges ?? false,
      publishedAt: roster?.publishedAt?.toISOString() ?? null,
    },
    mode: opts.mode,
    canEdit: opts.mode === "edit",
    days,
    employees: list,
    shifts,
    toAcknowledge,
  };
}

// ---------------------------------------------------------------------------------------------
// Editing the working copy
// ---------------------------------------------------------------------------------------------

const time = z.string().regex(HHMM, "Use the 24-hour format HH:MM, like 09:00.");

export const shiftInput = z.object({
  employeeId: z.uuid().nullable(),
  date: isoDate,
  kind: z.enum(["shift", "rest"]).default("shift"),
  templateId: z.uuid().nullable().default(null),
  startTime: time.optional(),
  endTime: time.optional(),
  breakMinutes: z.int().min(0).max(240).optional(),
  note: z.string().trim().max(200, "Keep the note to 200 characters.").nullable().default(null),
});
export type ShiftInput = z.output<typeof shiftInput>;

export const shiftUpdateInput = shiftInput.extend({
  /** The `updatedAt` the editor loaded; a different current value answers 409 `stale`. */
  expectedUpdatedAt: z.string().optional(),
});

interface Resolved {
  employeeId: string | null;
  kind: "shift" | "rest";
  date: string;
  startsAt: Date | null;
  endsAt: Date | null;
  breakMinutes: number;
  templateId: string | null;
  note: string | null;
}

async function resolve(db: Db, orgId: string, roster: Roster, input: ShiftInput): Promise<Resolved> {
  if (input.date < roster.weekStart || input.date > addDays(roster.weekStart, 6)) {
    throw new AppError("validation_failed", "That date is outside this roster's week.", {
      issues: [
        {
          path: "date",
          message: `Pick a date from ${dayLabel(roster.weekStart)} to ${dayLabel(addDays(roster.weekStart, 6))}.`,
        },
      ],
    });
  }
  if (input.kind === "rest") {
    if (!input.employeeId) {
      throw new AppError("validation_failed", "A rest day belongs to someone.", {
        issues: [{ path: "employeeId", message: "Choose whose rest day it is." }],
      });
    }
    return { ...input, startsAt: null, endsAt: null, breakMinutes: 0, templateId: null };
  }
  let start = input.startTime;
  let end = input.endTime;
  let brk = input.breakMinutes;
  if (input.templateId) {
    const t = await orgScope(db, orgId).getById(shiftTemplates, input.templateId, "shift template");
    if (t.archivedAt && !start) {
      throw new AppError("conflict", `${t.name} is archived. Pick another shift or enter the times.`);
    }
    start ??= t.startTime;
    end ??= t.endTime;
    brk ??= t.breakMinutes;
  }
  if (!start || !end) {
    throw new AppError("validation_failed", "A shift needs a start and end time.", {
      issues: [{ path: "startTime", message: "Pick a shift template or enter the start and end times." }],
    });
  }
  const { startsAt, endsAt } = shiftInstants(input.date, start, end);
  const breakMinutes = brk ?? 0;
  if (paidMinutes(startsAt, endsAt, breakMinutes) <= 0) {
    throw new AppError("validation_failed", "The break is as long as the shift.", {
      issues: [{ path: "breakMinutes", message: "Use a break shorter than the shift." }],
    });
  }
  return { ...input, startsAt, endsAt, breakMinutes };
}

async function assertAssignable(
  db: Db,
  orgId: string,
  grant: Grant,
  roster: Roster,
  eligible: ReadonlyMap<string, EmployeeTime>,
  employeeId: string | null,
  label: string,
) {
  if (!employeeId) return;
  if (!grant.all) await grant.assertEmployee(employeeId, "employee");
  if (!eligible.has(employeeId)) {
    const [e] = await db
      .select({ legalName: employees.legalName, preferredName: employees.preferredName })
      .from(employees)
      .where(orgScope(db, orgId).whereId(employees, employeeId));
    if (!e) throw new AppError("not_found", "That employee record doesn't exist or you can't see it.");
    throw new AppError(
      "not_eligible",
      `${displayName(e)} doesn't work at ${label} in the week of ${dayLabel(roster.weekStart)}. Change their location or department in People first.`,
    );
  }
  const [count] = await db
    .select({ n: sql<number>`count(distinct ${rosterShifts.employeeId})::int` })
    .from(rosterShifts)
    .where(
      orgScope(db, orgId).where(
        rosterShifts,
        eq(rosterShifts.rosterId, roster.id),
        ne(rosterShifts.employeeId, employeeId),
      ),
    );
  const [already] = await db
    .select({ id: rosterShifts.id })
    .from(rosterShifts)
    .where(
      orgScope(db, orgId).where(
        rosterShifts,
        eq(rosterShifts.rosterId, roster.id),
        eq(rosterShifts.employeeId, employeeId),
      ),
    )
    .limit(1);
  if (!already && Number(count?.n ?? 0) >= MAX_ROSTER_EMPLOYEES) {
    throw new AppError(
      "conflict",
      `A roster holds at most ${MAX_ROSTER_EMPLOYEES} employees. Split it by department to roster more people.`,
    );
  }
}

/** 409 `shift_overlap` when the employee already has an overlapping shift in any roster. */
export async function assertNoOverlap(
  db: Db,
  orgId: string,
  employeeId: string | null,
  startsAt: Date | null,
  endsAt: Date | null,
  exceptIds: readonly string[],
  table: typeof rosterShifts | typeof publishedShifts = rosterShifts,
) {
  if (!employeeId || !startsAt || !endsAt) return;
  const [clash] = await db
    .select()
    .from(table)
    .where(
      orgScope(db, orgId).where(
        table,
        eq(table.employeeId, employeeId),
        eq(table.kind, "shift"),
        lt(table.startsAt, endsAt),
        gt(table.endsAt, startsAt),
        exceptIds.length
          ? sql`${table.id} not in (${sql.join(
              exceptIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : undefined,
      ),
    )
    .limit(1);
  if (clash?.startsAt && clash.endsAt) {
    const [e] = await db
      .select({ legalName: employees.legalName, preferredName: employees.preferredName })
      .from(employees)
      .where(orgScope(db, orgId).whereId(employees, employeeId));
    throw new AppError(
      "shift_overlap",
      `${e ? displayName(e) : "This employee"} already works ${sgTime(clash.startsAt)}–${sgTime(clash.endsAt)} on ${dayLabel(clash.date)}. Change the times or pick someone else.`,
      { shiftId: clash.id, date: clash.date, start: sgTime(clash.startsAt), end: sgTime(clash.endsAt) },
    );
  }
}

async function assertOneRestDay(db: Db, orgId: string, r: Resolved, exceptId?: string) {
  if (r.kind !== "rest" || !r.employeeId) return;
  const [dup] = await db
    .select({ id: rosterShifts.id })
    .from(rosterShifts)
    .where(
      orgScope(db, orgId).where(
        rosterShifts,
        eq(rosterShifts.employeeId, r.employeeId),
        eq(rosterShifts.kind, "rest"),
        eq(rosterShifts.date, r.date),
        exceptId ? ne(rosterShifts.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (dup) throw new AppError("conflict", "That day is already marked as a rest day.");
}

async function touchRoster(db: Db, orgId: string, rosterId: string, now: Date) {
  await db
    .update(rosters)
    .set({ hasChanges: true, updatedAt: now })
    .where(orgScope(db, orgId).whereId(rosters, rosterId));
}

/** Open swap and pickup requests on shifts that changed are cancelled (their approval withdrawn). */
export async function cancelSwapsOn(
  db: Db,
  deps: AppDeps,
  actor: SchedulingActor,
  shiftIds: readonly string[],
  reason: string,
) {
  if (!shiftIds.length) return;
  const open = await db
    .select()
    .from(shiftSwaps)
    .where(
      orgScope(db, actor.orgId).where(
        shiftSwaps,
        inArray(shiftSwaps.status, [...OPEN_SWAP_STATUSES]),
        or(inArray(shiftSwaps.shiftId, [...shiftIds]), inArray(shiftSwaps.peerShiftId, [...shiftIds])),
      ),
    );
  for (const s of open) {
    await db
      .update(shiftSwaps)
      .set({ status: "cancelled", reason, decidedAt: deps.clock.now(), updatedAt: deps.clock.now() })
      .where(orgScope(db, actor.orgId).whereId(shiftSwaps, s.id));
    if (s.status === "pending_approval") {
      await withdrawSubject(db, deps, actor.audit, { orgId: actor.orgId, subjectType: "shift_swap", subjectId: s.id });
    }
    const people = [s.requesterEmployeeId, s.peerEmployeeId].filter((x): x is string => !!x);
    const members = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, actor.orgId),
          inArray(memberships.employeeId, people),
          eq(memberships.status, "active"),
        ),
      );
    await notify(db, deps, {
      orgId: actor.orgId,
      recipients: members.map((m) => m.id),
      kind: "roster_published",
      title: `A shift ${s.kind === "pickup" ? "pickup" : "swap"} request was cancelled: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
      link: "/schedules/me",
      subjectType: "shift_swap",
      subjectId: s.id,
    });
  }
}

async function loadEditable(deps: AppDeps, actor: SchedulingActor, grant: Grant, rosterId: string) {
  const roster = await loadRoster(deps.db, actor.orgId, rosterId);
  const eligible = await eligibleEmployees(deps.db, actor.orgId, refOf(roster));
  await assertCanEdit(grant, eligible);
  const label = await scopeLabel(deps.db, actor.orgId, refOf(roster));
  return { roster, eligible, label };
}

export async function createShift(
  deps: AppDeps,
  actor: SchedulingActor,
  grant: Grant,
  rosterId: string,
  input: ShiftInput,
): Promise<RosterShift> {
  const { roster, eligible, label } = await loadEditable(deps, actor, grant, rosterId);
  return deps.db.transaction(async (tx) => {
    const r = await resolve(tx, actor.orgId, roster, input);
    await assertAssignable(tx, actor.orgId, grant, roster, eligible, r.employeeId, label);
    await assertNoOverlap(tx, actor.orgId, r.employeeId, r.startsAt, r.endsAt, []);
    await assertOneRestDay(tx, actor.orgId, r);
    const now = deps.clock.now();
    const [row] = await tx
      .insert(rosterShifts)
      .values({ id: deps.ids.newId(), orgId: actor.orgId, rosterId, ...r, createdAt: now, updatedAt: now })
      .returning();
    await touchRoster(tx, actor.orgId, rosterId, now);
    return row as RosterShift;
  });
}

async function loadShiftForEdit(deps: AppDeps, actor: SchedulingActor, grant: Grant, shiftId: string) {
  const shift = await orgScope(deps.db, actor.orgId).getById(rosterShifts, shiftId, "shift");
  const ctx = await loadEditable(deps, actor, grant, shift.rosterId);
  if (!grant.all && shift.employeeId) await grant.assertEmployee(shift.employeeId, "shift");
  return { shift, ...ctx };
}

export async function updateShift(
  deps: AppDeps,
  actor: SchedulingActor,
  grant: Grant,
  shiftId: string,
  input: z.output<typeof shiftUpdateInput>,
): Promise<RosterShift> {
  const { shift, roster, eligible, label } = await loadShiftForEdit(deps, actor, grant, shiftId);
  return deps.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(rosterShifts)
      .where(orgScope(tx, actor.orgId).whereId(rosterShifts, shiftId))
      .for("update");
    if (!current) throw new AppError("not_found", "That shift doesn't exist or you can't see it.");
    if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) {
      throw new AppError(
        "stale",
        "Someone else changed this shift since you opened the roster. Reload and try again.",
        {
          updatedAt: current.updatedAt.toISOString(),
        },
      );
    }
    const r = await resolve(tx, actor.orgId, roster, input);
    if (r.employeeId !== shift.employeeId) {
      await assertAssignable(tx, actor.orgId, grant, roster, eligible, r.employeeId, label);
    }
    await assertNoOverlap(tx, actor.orgId, r.employeeId, r.startsAt, r.endsAt, [shiftId]);
    await assertOneRestDay(tx, actor.orgId, r, shiftId);
    const now = deps.clock.now();
    const [row] = await tx
      .update(rosterShifts)
      .set({ ...r, updatedAt: now })
      .where(orgScope(tx, actor.orgId).whereId(rosterShifts, shiftId))
      .returning();
    const changed =
      r.employeeId !== current.employeeId ||
      r.startsAt?.getTime() !== current.startsAt?.getTime() ||
      r.endsAt?.getTime() !== current.endsAt?.getTime() ||
      r.kind !== current.kind;
    if (changed) await cancelSwapsOn(tx, deps, actor, [shiftId], "The shift was changed on the roster.");
    await touchRoster(tx, actor.orgId, roster.id, now);
    return row as RosterShift;
  });
}

export async function deleteShift(deps: AppDeps, actor: SchedulingActor, grant: Grant, shiftId: string) {
  const { roster } = await loadShiftForEdit(deps, actor, grant, shiftId);
  await deps.db.transaction(async (tx) => {
    await cancelSwapsOn(tx, deps, actor, [shiftId], "The shift was removed from the roster.");
    await tx.delete(rosterShifts).where(orgScope(tx, actor.orgId).whereId(rosterShifts, shiftId));
    await touchRoster(tx, actor.orgId, roster.id, deps.clock.now());
  });
}

export interface CopySummary {
  copied: number;
  skipped: { employeeName: string; date: string; reason: string }[];
  message: string;
}

/** Copies last week's working copy into this roster (spec "Copy last week"). */
export async function copyPreviousWeek(
  deps: AppDeps,
  actor: SchedulingActor,
  grant: Grant,
  rosterId: string,
): Promise<CopySummary> {
  const { roster, eligible } = await loadEditable(deps, actor, grant, rosterId);
  const prevRef = { ...refOf(roster), weekStart: addDays(roster.weekStart, -7) };
  const prev = await findRoster(deps.db, actor.orgId, prevRef);
  if (!prev) {
    return {
      copied: 0,
      skipped: [],
      message: `There is no roster for the week of ${dayLabel(prevRef.weekStart)} to copy.`,
    };
  }
  const rows = await deps.db
    .select()
    .from(rosterShifts)
    .where(orgScope(deps.db, actor.orgId).where(rosterShifts, eq(rosterShifts.rosterId, prev.id)))
    .orderBy(asc(rosterShifts.date), asc(rosterShifts.startsAt));
  const prevTimes = await loadEmployeesTime(
    deps.db,
    actor.orgId,
    rows.map((r) => r.employeeId).filter((x): x is string => !!x),
  );
  const facts = await employeeFacts(deps.db, actor.orgId, [...prevTimes.keys()]);
  const mine = grant.all ? null : await grant.employeeIds();
  const skipped: CopySummary["skipped"] = [];
  let copied = 0;
  // Open shifts have no employee to overlap with: copying again must not add them again. Count the
  // ones the target already has, so two identical open shifts last week still copy as two.
  const openKey = (r: { date: string; startsAt: Date | null; endsAt: Date | null; templateId: string | null }) =>
    `${r.date}|${r.startsAt?.toISOString() ?? ""}|${r.endsAt?.toISOString() ?? ""}|${r.templateId ?? ""}`;
  const openThere = new Map<string, number>();
  for (const r of await deps.db
    .select()
    .from(rosterShifts)
    .where(
      orgScope(deps.db, actor.orgId).where(
        rosterShifts,
        eq(rosterShifts.rosterId, rosterId),
        isNull(rosterShifts.employeeId),
      ),
    ))
    openThere.set(openKey(r), (openThere.get(openKey(r)) ?? 0) + 1);
  await deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    for (const r of rows) {
      if (r.employeeId && mine && !mine.has(r.employeeId)) continue;
      const date = addDays(r.date, 7);
      if (!r.employeeId) {
        const key = openKey({
          date,
          startsAt: r.startsAt ? new Date(r.startsAt.getTime() + 7 * 86_400_000) : null,
          endsAt: r.endsAt ? new Date(r.endsAt.getTime() + 7 * 86_400_000) : null,
          templateId: r.templateId,
        });
        const already = openThere.get(key) ?? 0;
        if (already > 0) {
          openThere.set(key, already - 1);
          continue;
        }
      }
      const name = r.employeeId ? (facts.get(r.employeeId)?.name ?? "") : "Open shift";
      if (r.employeeId) {
        const t = prevTimes.get(r.employeeId);
        if (t && !tenureOn(t, date)) {
          const last = t.tenures.at(-1)?.lastWorkingDay;
          skipped.push({
            employeeName: name,
            date,
            reason: last ? `left on ${dayLabel(last).slice(4)}` : "not employed then",
          });
          continue;
        }
        if (!eligible.has(r.employeeId) || (t && !inScope(t, date, refOf(roster)))) {
          skipped.push({ employeeName: name, date, reason: "no longer works here" });
          continue;
        }
      }
      const startsAt = r.startsAt ? new Date(r.startsAt.getTime() + 7 * 86_400_000) : null;
      const endsAt = r.endsAt ? new Date(r.endsAt.getTime() + 7 * 86_400_000) : null;
      try {
        await assertNoOverlap(tx, actor.orgId, r.employeeId, startsAt, endsAt, []);
      } catch {
        skipped.push({ employeeName: name, date, reason: "already has a shift then" });
        continue;
      }
      if (r.kind === "rest") {
        const [dup] = await tx
          .select({ id: rosterShifts.id })
          .from(rosterShifts)
          .where(
            orgScope(tx, actor.orgId).where(
              rosterShifts,
              eq(rosterShifts.employeeId, r.employeeId as string),
              eq(rosterShifts.kind, "rest"),
              eq(rosterShifts.date, date),
            ),
          );
        if (dup) continue;
      }
      await tx.insert(rosterShifts).values({
        id: deps.ids.newId(),
        orgId: actor.orgId,
        rosterId,
        employeeId: r.employeeId,
        kind: r.kind,
        date,
        startsAt,
        endsAt,
        breakMinutes: r.breakMinutes,
        templateId: r.templateId,
        note: r.note,
        createdAt: now,
        updatedAt: now,
      });
      copied++;
    }
    if (copied) await touchRoster(tx, actor.orgId, rosterId, now);
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.roster_copied",
      targetType: "roster",
      targetId: rosterId,
      meta: { from: prev.id, copied, skipped: skipped.length },
    });
  });
  const word = (n: number) => (n === 1 ? "shift" : "shifts");
  const parts = [`${copied} ${word(copied)} copied.`];
  if (skipped.length) {
    parts.push(
      `${skipped.length} ${word(skipped.length)} not copied: ${[...new Set(skipped.map((s) => `${s.employeeName} ${s.reason}`))].join("; ")}.`,
    );
  }
  return { copied, skipped, message: parts.join(" ") };
}

/** Removes every shift the caller may edit from the working copy. */
export async function clearWeek(deps: AppDeps, actor: SchedulingActor, grant: Grant, rosterId: string) {
  await loadEditable(deps, actor, grant, rosterId);
  const mine = grant.all ? null : await grant.employeeIds();
  return deps.db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: rosterShifts.id, employeeId: rosterShifts.employeeId })
      .from(rosterShifts)
      .where(orgScope(tx, actor.orgId).where(rosterShifts, eq(rosterShifts.rosterId, rosterId)));
    const ids = rows.filter((r) => !mine || !r.employeeId || mine.has(r.employeeId)).map((r) => r.id);
    if (!ids.length) return 0;
    await cancelSwapsOn(tx, deps, actor, ids, "The roster week was cleared.");
    await tx.delete(rosterShifts).where(orgScope(tx, actor.orgId).where(rosterShifts, inArray(rosterShifts.id, ids)));
    await touchRoster(tx, actor.orgId, rosterId, deps.clock.now());
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.roster_cleared",
      targetType: "roster",
      targetId: rosterId,
      meta: { removed: ids.length },
    });
    return ids.length;
  });
}
