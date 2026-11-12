import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { authorize, type Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { auditContext } from "../audit/audit.ts";
import type { AppContext, AuthContext } from "../context.ts";
import { employmentRecords } from "../db/schema/employees.ts";
import { departments, locations, workSchedules } from "../db/schema/organisation.ts";
import {
  OPEN_SWAP_STATUSES,
  publishedShifts,
  rosterShifts,
  rosters,
  SHIFT_COLOURS,
  shiftSwaps,
  shiftTemplates,
} from "../db/schema/scheduling.ts";
import type { AppDeps } from "../deps.ts";
import { addDays } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { employmentOn, loadEmployeesTime } from "../leave/calendar.ts";
import { todaySg } from "../leave/views.ts";
import { rosterCsv } from "./export.ts";
import { inScope } from "./feeds.ts";
import { publishInput, publishRoster } from "./publish.ts";
import {
  buildRosterView,
  clearWeek,
  copyPreviousWeek,
  createShift,
  deleteShift,
  eligibleEmployees,
  ensureRoster,
  findRoster,
  isoDate,
  loadRoster,
  type RosterRef,
  rosterRefSchema,
  shiftInput,
  shiftUpdateInput,
  updateShift,
} from "./rosters.ts";
import { answerSwap, cancelSwap, mySwaps, requestSwap, swapInput, swapView, toSwapViews } from "./swaps.ts";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  type SchedulingActor,
  setTemplateArchived,
  templateInput,
  templateView,
  updateTemplate,
} from "./templates.ts";
import { mondayOf, paidMinutes, sgTime, weekDates } from "./time.ts";

/** HTTP surface of scheduling (`/api/v1/scheduling`). */

const id = z.object({ id: z.uuid() });

function actorOf(c: AppContext, auth: AuthContext): SchedulingActor {
  return { orgId: auth.orgId, membershipId: auth.membershipId, employeeId: auth.employeeId, audit: auditContext(c) };
}

/** The caller's `rosters:update` grant, or null when no role grants it. */
async function editGrant(c: AppContext): Promise<Grant | null> {
  try {
    return await authorize(c, "rosters:update");
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return null;
    throw err;
  }
}

const conflict = z.object({
  kind: z.enum([
    "overlap",
    "on_leave",
    "outside_employment",
    "pending_leave",
    "public_holiday",
    "rest_day",
    "daily_hours",
    "overtime",
    "weekly_hours",
    "no_rest_day",
    "ot_cap",
  ]),
  severity: z.enum(["block", "ack", "warning", "hint"]),
  label: z.string(),
  message: z.string(),
  source: z.string().nullable(),
});

const shiftView = z.object({
  id: z.uuid(),
  employeeId: z.uuid().nullable(),
  kind: z.enum(["shift", "rest"]),
  date: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  breakMinutes: z.number(),
  paidMinutes: z.number(),
  templateId: z.uuid().nullable(),
  templateCode: z.string().nullable(),
  colour: z.enum(SHIFT_COLOURS),
  note: z.string().nullable(),
  updatedAt: z.string(),
  conflicts: z.array(conflict),
  pendingSwap: z.boolean(),
});

const rosterView = z.object({
  roster: z.object({
    id: z.uuid().nullable(),
    weekStart: z.string(),
    locationId: z.uuid().nullable(),
    departmentId: z.uuid().nullable(),
    scopeLabel: z.string(),
    status: z.enum(["none", "draft", "published"]),
    version: z.number(),
    hasChanges: z.boolean(),
    publishedAt: z.string().nullable(),
  }),
  mode: z.enum(["edit", "published"]),
  canEdit: z.boolean(),
  days: z.array(z.object({ date: z.string(), holiday: z.string().nullable(), minutes: z.number() })),
  employees: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      employeeNumber: z.string(),
      schedule: z.enum(["fixed", "shift"]).nullable(),
      editable: z.boolean(),
      minutes: z.number(),
      restDayAssumed: z.string().nullable(),
      warnings: z.array(conflict),
    }),
  ),
  shifts: z.array(shiftView),
  toAcknowledge: z.array(
    z.object({ shiftId: z.uuid(), kind: z.string(), employeeName: z.string(), date: z.string(), message: z.string() }),
  ),
});

const savedShift = z.object({ id: z.uuid(), rosterId: z.uuid(), updatedAt: z.string() });

const rosterQuery = z.object({
  weekStart: isoDate,
  locationId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
});

/** Edit view for editors with an eligible team member; the published copy for staff on the roster; else 404. */
async function viewFor(c: AppContext, deps: AppDeps, auth: AuthContext, ref: RosterRef) {
  if (!ref.locationId && !ref.departmentId) {
    throw new AppError("validation_failed", "Choose a location or a department for the roster.", {
      issues: [{ path: "locationId", message: "Choose a location or a department." }],
    });
  }
  const eligible = await eligibleEmployees(deps.db, auth.orgId, ref);
  const edit = await editGrant(c);
  if (edit) {
    const team = edit.all ? null : await edit.employeeIds();
    if (!team || [...eligible.keys()].some((x) => team.has(x))) {
      return buildRosterView(deps, auth.orgId, ref, { mode: "edit", editableIds: team ?? "all" });
    }
  }
  const roster = await findRoster(deps.db, auth.orgId, ref);
  let onIt = !!auth.employeeId && eligible.has(auth.employeeId);
  if (!onIt && auth.employeeId && roster) {
    const [mine] = await deps.db
      .select({ id: publishedShifts.id })
      .from(publishedShifts)
      .where(
        orgScope(deps.db, auth.orgId).where(
          publishedShifts,
          eq(publishedShifts.rosterId, roster.id),
          eq(publishedShifts.employeeId, auth.employeeId),
        ),
      )
      .limit(1);
    onIt = !!mine;
  }
  if (!onIt) throw new AppError("not_found", "That roster doesn't exist or you can't see it.");
  const view = await buildRosterView(deps, auth.orgId, ref, { mode: "published", editableIds: null });
  // Staff see names, times and codes only, and never a draft.
  return {
    ...view,
    roster: {
      ...view.roster,
      status: view.roster.status === "published" ? ("published" as const) : ("none" as const),
      hasChanges: false,
      version: view.roster.status === "published" ? view.roster.version : 0,
    },
    employees: view.employees.map((e) => ({ ...e, employeeNumber: "", warnings: [], restDayAssumed: null })),
    toAcknowledge: [],
  };
}

const refOfRoster = (r: { weekStart: string; locationId: string | null; departmentId: string | null }): RosterRef => ({
  weekStart: r.weekStart,
  locationId: r.locationId,
  departmentId: r.departmentId,
});

const myShift = z.object({
  id: z.uuid(),
  rosterId: z.uuid(),
  scopeLabel: z.string(),
  date: z.string(),
  kind: z.enum(["shift", "rest"]),
  start: z.string().nullable(),
  end: z.string().nullable(),
  breakMinutes: z.number(),
  paidMinutes: z.number(),
  templateCode: z.string().nullable(),
  colour: z.enum(SHIFT_COLOURS),
  note: z.string().nullable(),
  pendingSwap: z.boolean(),
});

const meView = z.object({
  employeeId: z.uuid().nullable(),
  from: z.string(),
  to: z.string(),
  shifts: z.array(myShift),
  weeks: z.array(z.object({ weekStart: z.string(), published: z.boolean() })),
  openShifts: z.array(myShift),
  swaps: z.array(swapView),
});

async function scopeNames(deps: AppDeps, orgId: string) {
  const org = orgScope(deps.db, orgId);
  const locs = await deps.db.select().from(locations).where(org.where(locations));
  const depts = await deps.db.select().from(departments).where(org.where(departments));
  return (r: { locationId: string | null; departmentId: string | null }) =>
    [locs.find((l) => l.id === r.locationId)?.name, depts.find((d) => d.id === r.departmentId)?.name]
      .filter(Boolean)
      .join(" · ");
}

/** My schedule: published shifts, which weeks are published, open shifts I may pick up, my swaps. */
async function mySchedule(deps: AppDeps, auth: AuthContext, from: string, to: string) {
  const employeeId = auth.employeeId;
  if (!employeeId) return { employeeId: null, from, to, shifts: [], weeks: [], openShifts: [], swaps: [] };
  const db = deps.db;
  const org = orgScope(db, auth.orgId);
  const weekFrom = mondayOf(from);
  const weekTo = mondayOf(to);
  const label = await scopeNames(deps, auth.orgId);
  const tpls = await db.select().from(shiftTemplates).where(org.where(shiftTemplates));
  const tpl = new Map(tpls.map((t) => [t.id, t]));
  const rosterRows = await db
    .select()
    .from(rosters)
    .where(org.where(rosters, gte(rosters.weekStart, weekFrom), lte(rosters.weekStart, weekTo)));
  const t = (await loadEmployeesTime(db, auth.orgId, [employeeId])).get(employeeId);
  const mineRosters = rosterRows.filter((r) => t && weekDates(r.weekStart).some((d) => inScope(t, d, r)));
  const rows = await db
    .select()
    .from(publishedShifts)
    .where(
      org.where(
        publishedShifts,
        eq(publishedShifts.employeeId, employeeId),
        gte(publishedShifts.date, from),
        lte(publishedShifts.date, to),
      ),
    )
    .orderBy(asc(publishedShifts.date), asc(publishedShifts.startsAt));
  const visibleRosterIds = [...new Set([...mineRosters.map((r) => r.id), ...rows.map((r) => r.rosterId)])];
  const open = visibleRosterIds.length
    ? await db
        .select()
        .from(publishedShifts)
        .where(
          org.where(
            publishedShifts,
            isNull(publishedShifts.employeeId),
            inArray(publishedShifts.rosterId, visibleRosterIds),
            gte(publishedShifts.date, from),
            lte(publishedShifts.date, to),
            gte(publishedShifts.startsAt, deps.clock.now()),
          ),
        )
        .orderBy(asc(publishedShifts.date), asc(publishedShifts.startsAt))
    : [];
  const swaps = await db
    .select({ shiftId: shiftSwaps.shiftId, peerShiftId: shiftSwaps.peerShiftId })
    .from(shiftSwaps)
    .where(org.where(shiftSwaps, inArray(shiftSwaps.status, [...OPEN_SWAP_STATUSES])));
  const busy = new Set(swaps.flatMap((s) => [s.shiftId, s.peerShiftId]));
  const rosterById = new Map(rosterRows.map((r) => [r.id, r]));
  const extra = rows.filter((r) => !rosterById.has(r.rosterId)).map((r) => r.rosterId);
  if (extra.length) {
    for (const r of await db
      .select()
      .from(rosters)
      .where(org.where(rosters, inArray(rosters.id, extra)))) {
      rosterById.set(r.id, r);
    }
  }
  const toView = (r: (typeof rows)[number]) => {
    const template = r.templateId ? tpl.get(r.templateId) : undefined;
    const roster = rosterById.get(r.rosterId);
    return {
      id: r.id,
      rosterId: r.rosterId,
      scopeLabel: roster ? label(roster) : "",
      date: r.date,
      kind: r.kind,
      start: r.startsAt ? sgTime(r.startsAt) : null,
      end: r.endsAt ? sgTime(r.endsAt) : null,
      breakMinutes: r.breakMinutes,
      paidMinutes: r.startsAt && r.endsAt ? paidMinutes(r.startsAt, r.endsAt, r.breakMinutes) : 0,
      templateCode: template?.code ?? null,
      colour: template?.colour ?? ("plain" as const),
      note: r.note,
      pendingSwap: busy.has(r.id),
    };
  };
  const weeks: { weekStart: string; published: boolean }[] = [];
  for (let w = weekFrom; w <= weekTo; w = addDays(w, 7)) {
    const relevant = rosterRows.filter(
      (r) => r.weekStart === w && (mineRosters.includes(r) || rows.some((x) => x.rosterId === r.id)),
    );
    weeks.push({ weekStart: w, published: relevant.some((r) => r.status === "published") });
  }
  return {
    employeeId,
    from,
    to,
    shifts: rows.map(toView),
    weeks,
    openShifts: open.filter((o) => !busy.has(o.id)).map(toView),
    swaps: await mySwaps(db, auth.orgId, employeeId),
  };
}

const scopeOption = z.object({ id: z.uuid(), name: z.string() });

export const schedulingModule = defineModule({
  name: "scheduling",
  feature: "scheduling",
  basePath: "/scheduling",
  tag: "Scheduling",
  routes: [
    // Templates ---------------------------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/templates",
      summary: "Shift templates (active; add includeArchived=true for all)",
      access: { permission: "rosters:read" },
      request: { query: z.object({ includeArchived: z.enum(["true", "false"]).optional() }) },
      responses: { 200: z.object({ items: z.array(templateView) }) },
      handler: async ({ deps, auth, query }) => ({
        items: await listTemplates(deps.db, auth.orgId, { includeArchived: query.includeArchived === "true" }),
      }),
    }),
    defineRoute({
      method: "post",
      path: "/templates",
      summary: "Create a shift template",
      access: { permission: "shift_templates:update" },
      request: { body: templateInput },
      responses: { 201: z.object({ id: z.uuid() }) },
      errors: ["conflict", "not_found"],
      handler: async ({ c, deps, auth, body }) => ({ id: await createTemplate(deps, actorOf(c, auth), body) }),
    }),
    defineRoute({
      method: "put",
      path: "/templates/:id",
      summary: "Update a shift template (existing shifts keep their times)",
      access: { permission: "shift_templates:update" },
      request: { params: id, body: templateInput },
      responses: { 204: null },
      errors: ["conflict", "not_found"],
      example: {
        body: {
          name: "Morning",
          code: "AM",
          startTime: "07:00",
          endTime: "15:00",
          breakMinutes: 30,
          locationId: null,
          colour: "plain",
        },
      },
      handler: async ({ c, deps, auth, params, body }) => {
        await updateTemplate(deps, actorOf(c, auth), params.id, body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/templates/:id/archive",
      summary: "Archive a shift template (shifts using it are kept)",
      access: { permission: "shift_templates:update" },
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        await setTemplateArchived(deps, actorOf(c, auth), params.id, true);
      },
    }),
    defineRoute({
      method: "post",
      path: "/templates/:id/restore",
      summary: "Restore an archived shift template",
      access: { permission: "shift_templates:update" },
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        await setTemplateArchived(deps, actorOf(c, auth), params.id, false);
      },
    }),
    defineRoute({
      method: "delete",
      path: "/templates/:id",
      summary: "Delete a shift template no roster has used (otherwise archive it)",
      access: { permission: "shift_templates:update" },
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found", "in_use"],
      handler: async ({ c, deps, auth, params }) => {
        await deleteTemplate(deps, actorOf(c, auth), params.id);
      },
    }),
    // Rosters -----------------------------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/scopes",
      summary: "Locations and departments a roster can be built for, and the caller's own",
      access: { permission: "rosters:read" },
      responses: {
        200: z.object({
          locations: z.array(scopeOption),
          departments: z.array(scopeOption),
          mine: z.object({ locationId: z.uuid().nullable(), departmentId: z.uuid().nullable() }),
          /**
           * Locations where people work rostered shifts: first those with shifts on a roster, then
           * those where someone working there today is on a shift work schedule, each in `locations`
           * order. An editor whose own location is neither (an owner at a head office of fixed-week
           * staff) can open on the first, which has a roster to look at.
           */
          rosteredLocationIds: z.array(z.uuid()),
          canEdit: z.boolean(),
        }),
      },
      handler: async ({ c, deps, auth }) => {
        const org = orgScope(deps.db, auth.orgId);
        const locs = await deps.db
          .select()
          .from(locations)
          .where(org.where(locations, isNull(locations.archivedAt)));
        const today = todaySg(deps);
        const withShifts = await deps.db
          .selectDistinct({ locationId: rosters.locationId })
          .from(rosters)
          .innerJoin(rosterShifts, and(eq(rosterShifts.orgId, rosters.orgId), eq(rosterShifts.rosterId, rosters.id)))
          .where(org.where(rosters, isNotNull(rosters.locationId)));
        const withShiftStaff = await deps.db
          .selectDistinct({ locationId: employmentRecords.locationId })
          .from(employmentRecords)
          .innerJoin(
            workSchedules,
            and(
              eq(workSchedules.orgId, employmentRecords.orgId),
              eq(workSchedules.id, employmentRecords.workScheduleId),
            ),
          )
          .where(
            org.where(
              employmentRecords,
              isNotNull(employmentRecords.locationId),
              eq(workSchedules.kind, "shift"),
              lte(employmentRecords.effectiveFrom, today),
              or(isNull(employmentRecords.effectiveTo), gt(employmentRecords.effectiveTo, today)),
            ),
          );
        const hasShifts = new Set(withShifts.map((r) => r.locationId));
        const hasShiftStaff = new Set(withShiftStaff.map((r) => r.locationId));
        const depts = await deps.db
          .select()
          .from(departments)
          .where(org.where(departments, isNull(departments.archivedAt)));
        let mine = { locationId: null as string | null, departmentId: null as string | null };
        if (auth.employeeId) {
          const t = (await loadEmployeesTime(deps.db, auth.orgId, [auth.employeeId])).get(auth.employeeId);
          const e = t ? (employmentOn(t, todaySg(deps)) ?? t.employment.at(-1)) : null;
          if (e) mine = { locationId: e.locationId, departmentId: e.locationId ? null : e.departmentId };
        }
        const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
        const sortedLocs = locs.sort(byName);
        return {
          locations: sortedLocs.map((l) => ({ id: l.id, name: l.name })),
          departments: depts.sort(byName).map((d) => ({ id: d.id, name: d.name })),
          mine,
          rosteredLocationIds: [
            ...sortedLocs.filter((l) => hasShifts.has(l.id)),
            ...sortedLocs.filter((l) => !hasShifts.has(l.id) && hasShiftStaff.has(l.id)),
          ].map((l) => l.id),
          canEdit: !!(await editGrant(c)),
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/rosters",
      summary: "A roster week by scope: the working copy with conflicts for editors, the published copy for staff",
      access: { permission: "rosters:read" },
      request: { query: rosterQuery },
      responses: { 200: rosterView },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, query }) =>
        viewFor(c, deps, auth, {
          weekStart: mondayOf(query.weekStart),
          locationId: query.locationId ?? null,
          departmentId: query.departmentId ?? null,
        }),
    }),
    defineRoute({
      method: "get",
      path: "/rosters/:id",
      summary: "A roster week by id",
      access: { permission: "rosters:read" },
      request: { params: id },
      responses: { 200: rosterView },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) =>
        viewFor(c, deps, auth, refOfRoster(await loadRoster(deps.db, auth.orgId, params.id))),
    }),
    defineRoute({
      method: "post",
      path: "/rosters",
      summary: "Open (or create) the draft roster for a scope and week",
      access: { permission: "rosters:create" },
      request: { body: rosterRefSchema },
      responses: { 200: z.object({ id: z.uuid() }) },
      errors: ["not_found"],
      crossOrgExempt: "addresses a roster by scope and week, not by record id",
      handler: async ({ c, deps, auth, grant, body }) => ({
        id: (await ensureRoster(deps, actorOf(c, auth), grant, body)).id,
      }),
    }),
    defineRoute({
      method: "post",
      path: "/rosters/:id/shifts",
      summary: "Add a shift, an open shift or a rest day to the working copy",
      access: { permission: "rosters:update" },
      request: { params: id, body: shiftInput },
      responses: { 201: savedShift },
      errors: ["not_found", "shift_overlap", "not_eligible", "conflict"],
      example: {
        body: { employeeId: null, date: "2026-11-02", startTime: "09:00", endTime: "17:00", breakMinutes: 60 },
      },
      handler: async ({ c, deps, auth, grant, params, body }) => {
        const r = await createShift(deps, actorOf(c, auth), grant, params.id, body);
        return { id: r.id, rosterId: r.rosterId, updatedAt: r.updatedAt.toISOString() };
      },
    }),
    defineRoute({
      method: "patch",
      path: "/shifts/:id",
      summary: "Change or move a shift in the working copy (409 stale when someone else changed it)",
      access: { permission: "rosters:update" },
      request: { params: id, body: shiftUpdateInput },
      responses: { 200: savedShift },
      errors: ["not_found", "shift_overlap", "not_eligible", "conflict", "stale"],
      example: {
        body: { employeeId: null, date: "2026-11-02", startTime: "09:00", endTime: "17:00", breakMinutes: 60 },
      },
      handler: async ({ c, deps, auth, grant, params, body }) => {
        const r = await updateShift(deps, actorOf(c, auth), grant, params.id, body);
        return { id: r.id, rosterId: r.rosterId, updatedAt: r.updatedAt.toISOString() };
      },
    }),
    defineRoute({
      method: "delete",
      path: "/shifts/:id",
      summary: "Remove a shift from the working copy (open swap requests on it are cancelled)",
      access: { permission: "rosters:update" },
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, grant, params }) => {
        await deleteShift(deps, actorOf(c, auth), grant, params.id);
      },
    }),
    defineRoute({
      method: "post",
      path: "/rosters/:id/copy-previous",
      summary: "Copy last week's shifts into this roster, skipping people who left or moved",
      access: { permission: "rosters:update" },
      request: { params: id },
      responses: {
        200: z.object({
          copied: z.number(),
          skipped: z.array(z.object({ employeeName: z.string(), date: z.string(), reason: z.string() })),
          message: z.string(),
        }),
      },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, grant, params }) => copyPreviousWeek(deps, actorOf(c, auth), grant, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/rosters/:id/clear",
      summary: "Remove every shift you may edit from this week's working copy",
      access: { permission: "rosters:update" },
      request: { params: id },
      responses: { 200: z.object({ removed: z.number() }) },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, grant, params }) => ({
        removed: await clearWeek(deps, actorOf(c, auth), grant, params.id),
      }),
    }),
    defineRoute({
      method: "post",
      path: "/rosters/:id/publish",
      summary: "Publish the working copy: staff, attendance, leave and payroll see it; changed staff are notified",
      description:
        "Every `on_leave` and `outside_employment` conflict must be listed in `acknowledge`, or the call answers 409 `unacknowledged_conflicts` with the list.",
      access: { permission: "rosters:publish" },
      request: { params: id, body: publishInput },
      responses: {
        200: z.object({
          version: z.number(),
          publishedAt: z.string(),
          notified: z.number(),
          changedEmployees: z.number(),
        }),
      },
      errors: ["not_found", "unacknowledged_conflicts", "shift_overlap"],
      example: { body: { acknowledge: [] } },
      handler: async ({ c, deps, auth, grant, params, body }) => {
        const r = await publishRoster(deps, actorOf(c, auth), grant, params.id, body);
        return {
          version: r.roster.version,
          publishedAt: (r.roster.publishedAt as Date).toISOString(),
          notified: r.notified,
          changedEmployees: r.changedEmployees,
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/rosters/:id/export.csv",
      summary: "Roster week as CSV (one row per shift, with conflicts)",
      access: { permission: "rosters:update" },
      request: { params: id },
      responses: { 200: { description: "CSV file", contentType: "text/csv" } },
      errors: ["not_found"],
      handler: async ({ deps, auth, grant, params }) => {
        const roster = await loadRoster(deps.db, auth.orgId, params.id);
        const ref = refOfRoster(roster);
        const eligible = await eligibleEmployees(deps.db, auth.orgId, ref);
        const team = grant.all ? null : await grant.employeeIds();
        if (team && ![...eligible.keys()].some((x) => team.has(x))) {
          throw new AppError("not_found", "That roster doesn't exist or you can't see it.");
        }
        const view = await buildRosterView(deps, auth.orgId, ref, { mode: "edit", editableIds: team ?? "all" });
        return new Response(rosterCsv(view), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="roster-${roster.weekStart}.csv"`,
          },
        });
      },
    }),
    // My schedule and swaps -------------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/me",
      summary: "My published shifts (default: the next 14 days), open shifts I may pick up, and my swaps",
      access: "authenticated",
      request: { query: z.object({ from: isoDate.optional(), to: isoDate.optional() }) },
      responses: { 200: meView },
      handler: async ({ deps, auth, query }) => {
        const from = query.from ?? todaySg(deps);
        const to = query.to ?? addDays(from, 13);
        if (to < from || addDays(from, 62) < to) {
          throw new AppError("validation_failed", "Choose a range of up to 62 days.", {
            issues: [{ path: "to", message: "Pick an end date on or after the start, at most 62 days later." }],
          });
        }
        return mySchedule(deps, auth, from, to);
      },
    }),
    defineRoute({
      method: "get",
      path: "/swaps",
      summary: "My swap and pickup requests (sent and received)",
      access: "authenticated",
      responses: { 200: z.object({ items: z.array(swapView) }) },
      handler: async ({ deps, auth }) => ({
        items: auth.employeeId ? await mySwaps(deps.db, auth.orgId, auth.employeeId) : [],
      }),
    }),
    defineRoute({
      method: "post",
      path: "/swaps",
      summary: "Offer a shift to a colleague (swap or give-away), or ask for an open shift",
      access: { permission: "shift_swaps:create" },
      request: { body: swapInput },
      responses: { 201: swapView },
      errors: ["not_found", "conflict", "stale", "shift_overlap", "not_eligible"],
      handler: async ({ c, deps, auth, body }) => {
        const swap = await requestSwap(deps, actorOf(c, auth), body);
        const [view] = await toSwapViews(deps.db, auth.orgId, [swap], auth.employeeId);
        return view as z.input<typeof swapView>;
      },
    }),
    ...(["accept", "decline"] as const).map((action) =>
      defineRoute({
        method: "post",
        path: `/swaps/:id/${action}`,
        summary:
          action === "accept"
            ? "Accept a colleague's swap offer (sends it for approval)"
            : "Decline a colleague's swap offer",
        access: "authenticated",
        request: { params: id },
        responses: { 200: swapView },
        errors: ["not_found", "conflict", "stale", "shift_overlap"],
        handler: async ({ c, deps, auth, params }) => {
          const swap = await answerSwap(deps, actorOf(c, auth), params.id, action === "accept");
          const [view] = await toSwapViews(deps.db, auth.orgId, [swap], auth.employeeId);
          return view as z.input<typeof swapView>;
        },
      }),
    ),
    defineRoute({
      method: "post",
      path: "/swaps/:id/cancel",
      summary: "Cancel my swap or pickup request before it is approved",
      access: "authenticated",
      request: { params: id },
      responses: { 200: swapView },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        const swap = await cancelSwap(deps, actorOf(c, auth), params.id);
        const [view] = await toSwapViews(deps.db, auth.orgId, [swap], auth.employeeId);
        return view as z.input<typeof swapView>;
      },
    }),
  ],
});
