import { z } from "zod";
import { authorize, can, type Grant } from "../access/authorize.ts";
import type { Permission } from "../access/matrix.ts";
import { auditContext, clientIp } from "../audit/audit.ts";
import type { AppContext, AuthContext } from "../context.ts";
import { isIsoDate } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute, reply } from "../http/route.ts";
import { todaySg } from "../leave/views.ts";
import { addCorrection, correctionInput, voidInput, voidPunch } from "./corrections.ts";
import { listApprovedOvertime } from "./outputs.ts";
import {
  claimInput,
  claimListQuery,
  claimView,
  createClaim,
  listClaims,
  loadClaim,
  toClaimViews,
  withdrawClaim,
} from "./overtime.ts";
import {
  isPeriodOver,
  nextPeriod,
  type Period,
  periodLabel,
  periodOf,
  previousPeriod,
  submittableFrom,
} from "./periods.ts";
import { punchInput, punchStatus, punchView, recordPunch, toPunchView } from "./punch.ts";
import { assertRange, attendanceSummary, employeesInScope, summaryCsv, summaryQuery, summaryRow } from "./reports.ts";
import {
  DEFAULT_PDPA_NOTICE,
  loadAttendanceSettings,
  saveAttendanceSettings,
  settingsInput,
  settingsView,
  timesheetSettings,
  timesheetSettingsOf,
  toSettingsView,
} from "./settings.ts";
import { timesheets, totalsOf } from "./timesheet.ts";
import {
  latestTimesheets,
  loadTimesheet,
  myTasks,
  reopenInput,
  reopenTimesheet,
  submitInput,
  submitTimesheet,
  timesheetView,
  toTimesheetViews,
  totalsView,
  withdrawTimesheet,
} from "./timesheet-approval.ts";

/** HTTP surface of attendance and overtime (`/api/v1/attendance`). */

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-11-12." });
const id = z.object({ id: z.uuid() });

function actorOf(c: AppContext, auth: AuthContext) {
  return { orgId: auth.orgId, membershipId: auth.membershipId, employeeId: auth.employeeId, audit: auditContext(c) };
}

function ownEmployee(auth: AuthContext): string {
  if (!auth.employeeId) {
    throw new AppError(
      "forbidden",
      "Your sign-in isn't linked to an employee record, so there is nothing to clock. Ask HR to link it.",
    );
  }
  return auth.employeeId;
}

const flag = z.enum(["clock_skew", "late_sync", "outside_location", "no_location", "ip_not_allowed"]);

const dayRecord = z.object({
  date: z.string(),
  dayType: z.enum(["working", "half", "off", "rest", "public_holiday", "leave", "shift", "not_employed"]),
  holiday: z.string().nullable(),
  leave: z.object({ session: z.enum(["full", "am", "pm"]), label: z.string() }).nullable(),
  scheduledMinutes: z.number(),
  scheduledStart: z.string().nullable(),
  firstIn: z.string().nullable(),
  lastOut: z.string().nullable(),
  workedMinutes: z.number(),
  breakMinutes: z.number(),
  lateMinutes: z.number(),
  earlyOutMinutes: z.number(),
  missingPunches: z.number(),
  open: z.boolean(),
  flags: z.array(flag),
  otMinutes: z.number(),
  punches: z.array(punchView),
  otClaim: z
    .object({
      id: z.uuid(),
      status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
      claimedMinutes: z.number(),
      approvedMinutes: z.number().nullable(),
    })
    .nullable(),
  locked: z.boolean().meta({
    description:
      "Inside an approved timesheet while timesheet approval is on: punches, manager corrections and new overtime claims are refused.",
  }),
});

const totals = totalsView;

const sheetView = z.object({
  employee: z.object({ id: z.uuid(), name: z.string() }),
  days: z.array(dayRecord),
  totals,
});

const statusView = z.object({
  employeeId: z.uuid().nullable(),
  serverTime: z.string(),
  clockedIn: z.boolean(),
  lastPunch: punchView.nullable(),
  today: z.array(punchView),
  location: z.object({
    mode: z.enum(["off", "optional", "required"]),
    /** Show before the first punch whenever location is collected. */
    pdpaNotice: z.string().nullable(),
    offices: z.array(z.object({ name: z.string(), radiusMetres: z.number() })),
  }),
  networkRestricted: z.boolean(),
  /** Whether timesheets are submitted for approval, by period, and by whom. */
  timesheets: timesheetSettings.pick({ approval: true, period: true, submittedBy: true }),
});

const claimResult = z.object({ claim: claimView, warnings: z.array(z.string()) });

const sheetQuery = z.object({ employeeId: z.uuid().optional(), from: isoDate, to: isoDate });

const periodView = z.object({ start: z.string(), end: z.string(), label: z.string() });

const overviewItem = z.object({
  employee: z.object({ id: z.uuid(), name: z.string() }),
  /** The period's totals as they are now. */
  totals,
  status: z.enum(["not_submitted", "submitted", "approved", "returned", "withdrawn", "reopened"]),
  /** The latest submission overlapping the period. */
  timesheet: timesheetView.nullable(),
  /** Your open approval task for it (decide with `POST /approvals/tasks/{id}/decision`). */
  taskId: z.uuid().nullable(),
  canSubmit: z.boolean(),
  canWithdraw: z.boolean(),
  canReopen: z.boolean(),
});

const overviewView = z.object({
  settings: timesheetSettings,
  period: periodView,
  previous: periodView,
  next: periodView,
  /** True once the period can be submitted (from 04:00 SGT the day after it ends). */
  over: z.boolean(),
  submittableFrom: z.string(),
  items: z.array(overviewItem),
});

const submitResult = z.object({ timesheet: timesheetView, warnings: z.array(z.string()) });

async function grantOrNull(c: AppContext, permission: Permission): Promise<Grant | null> {
  try {
    return await authorize(c, permission);
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return null;
    throw err;
  }
}

const withLabel = (p: Period) => ({ ...p, label: periodLabel(p) });

export const attendanceModule = defineModule({
  name: "attendance",
  basePath: "/attendance",
  tag: "Attendance",
  feature: "attendance.offlinePunch",
  routes: [
    defineRoute({
      method: "get",
      path: "/me",
      summary: "Clock-in status: today's punches, whether you are clocked in, and the location notice",
      access: "authenticated",
      responses: { 200: statusView },
      handler: async ({ deps, auth }) => {
        const settings = await loadAttendanceSettings(deps.db, auth.orgId);
        const now = deps.clock.now();
        const base = {
          serverTime: now.toISOString(),
          location: {
            mode: settings.locationMode,
            pdpaNotice: settings.locationMode === "off" ? null : settings.pdpaNotice || DEFAULT_PDPA_NOTICE,
            offices: settings.offices.map((o) => ({ name: o.name, radiusMetres: o.radiusMetres })),
          },
          networkRestricted: settings.allowedIps.length > 0,
          timesheets: {
            approval: settings.timesheetApproval,
            period: settings.timesheetPeriod,
            submittedBy: settings.timesheetSubmitter,
          },
        };
        if (!auth.employeeId) return { ...base, employeeId: null, clockedIn: false, lastPunch: null, today: [] };
        const s = await punchStatus(deps.db, auth.orgId, auth.employeeId, now);
        return {
          ...base,
          employeeId: auth.employeeId,
          clockedIn: s.clockedIn,
          lastPunch: s.lastPunch ? toPunchView(s.lastPunch) : null,
          today: s.today.map(toPunchView),
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/punches",
      summary: "Clock in or out (idempotent: a retried key returns the original punch with 200)",
      description:
        "Send `deviceTime` (the tap) and `sentAt` (device clock when sending). The server records its own time and the corrected time, and flags clock skew and late sync. Queued offline punches are sent in order with `queued: true`.",
      access: { permission: "attendance:create" },
      request: { body: punchInput },
      responses: { 201: punchView.extend({ replayed: z.boolean() }), 200: punchView.extend({ replayed: z.boolean() }) },
      errors: ["punch_rejected", "outside_location", "ip_not_allowed"],
      handler: async ({ c, deps, auth, body }) => {
        const employeeId = ownEmployee(auth);
        const r = await recordPunch(deps, auditContext(c), {
          orgId: auth.orgId,
          employeeId,
          membershipId: auth.membershipId,
          ip: clientIp(c),
          punch: body,
        });
        const view = { ...toPunchView(r.punch), replayed: r.replayed };
        // 200 is the default (lowest) status: a replay; a new punch answers 201.
        return r.replayed ? view : reply(201, view);
      },
    }),
    defineRoute({
      method: "get",
      path: "/timesheet",
      summary: "Daily timesheet for an employee (default: yours) over up to 62 days",
      access: { permission: "attendance:read" },
      request: { query: sheetQuery },
      responses: { 200: sheetView },
      handler: async ({ deps, auth, grant, query }) => {
        assertRange(query.from, query.to, 62);
        const employeeId = query.employeeId ?? ownEmployee(auth);
        await grant.assertEmployee(employeeId, "employee");
        const sheet = await timesheets(deps.db, auth.orgId, [employeeId], query.from, query.to, todaySg(deps));
        const days = sheet.days.get(employeeId);
        if (!days) throw new AppError("not_found", "That employee record doesn't exist or you can't see it.");
        return {
          employee: { id: employeeId, name: sheet.times.get(employeeId)?.name ?? "" },
          days,
          totals: totalsOf(days),
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/team",
      summary: "Timesheets of everyone you can see (your reports; everyone for admins) over up to 31 days",
      access: { permission: "attendance:read" },
      request: { query: z.object({ from: isoDate, to: isoDate }) },
      responses: { 200: z.object({ items: z.array(sheetView) }) },
      handler: async ({ deps, auth, grant, query }) => {
        assertRange(query.from, query.to, 31);
        const ids = await employeesInScope(deps.db, auth.orgId, grant, query.from, query.to);
        const sheet = await timesheets(deps.db, auth.orgId, ids, query.from, query.to, todaySg(deps));
        const items = [...sheet.days].map(([employeeId, days]) => ({
          employee: { id: employeeId, name: sheet.times.get(employeeId)?.name ?? "" },
          days,
          totals: totalsOf(days),
        }));
        return { items: items.sort((a, b) => a.employee.name.localeCompare(b.employee.name)) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/corrections",
      summary: "Add a missing punch to someone's timesheet, with a reason (audited)",
      description:
        "A day inside an approved timesheet answers 409 `timesheet_locked`; owners and HR admins resend with `reopen: true` to correct it and reopen the timesheet.",
      access: { permission: "attendance:update" },
      request: { body: correctionInput },
      responses: { 201: punchView },
      errors: ["not_found", "self_change_requires_approval", "timesheet_locked"],
      handler: async ({ c, deps, auth, grant, body }) =>
        toPunchView(
          await addCorrection(deps, actorOf(c, auth), grant, body, { canReopen: await can(c, "attendance:reopen") }),
        ),
    }),
    defineRoute({
      method: "post",
      path: "/punches/:id/void",
      summary: "Void a wrong punch, with a reason (the original is kept; audited)",
      access: { permission: "attendance:update" },
      request: { params: id, body: voidInput },
      responses: { 200: punchView },
      errors: ["not_found", "conflict", "self_change_requires_approval", "timesheet_locked"],
      example: { body: { reason: "Clocked in twice" } },
      handler: async ({ c, deps, auth, grant, params, body }) =>
        toPunchView(
          await voidPunch(deps, actorOf(c, auth), grant, params.id, body, {
            canReopen: await can(c, "attendance:reopen"),
          }),
        ),
    }),
    defineRoute({
      method: "post",
      path: "/overtime",
      summary: "Claim overtime for a day (up to the timesheet's OT; warns past 72 hours a month)",
      access: { permission: "attendance:create" },
      request: { body: claimInput },
      responses: { 201: claimResult },
      errors: ["not_found", "conflict", "timesheet_locked"],
      handler: async ({ c, deps, auth, grant, body }) => {
        const r = await createClaim(deps, actorOf(c, auth), grant, body);
        const [view] = await toClaimViews(deps.db, auth.orgId, [r.claim]);
        if (!view) throw new Error("claim view missing");
        return { claim: view, warnings: r.warnings };
      },
    }),
    defineRoute({
      method: "get",
      path: "/overtime",
      summary: "List overtime claims you can see",
      access: { permission: "attendance:read" },
      request: { query: claimListQuery },
      responses: { 200: z.object({ items: z.array(claimView) }) },
      handler: async ({ deps, auth, grant, query }) => ({ items: await listClaims(deps.db, auth.orgId, grant, query) }),
    }),
    defineRoute({
      method: "get",
      path: "/overtime/:id",
      summary: "Get an overtime claim",
      access: { permission: "attendance:read" },
      request: { params: id },
      responses: { 200: claimView },
      errors: ["not_found"],
      handler: async ({ deps, auth, grant, params }) => {
        const claim = await loadClaim(deps.db, auth.orgId, params.id);
        await grant.assertEmployee(claim.employeeId, "overtime claim");
        const [view] = await toClaimViews(deps.db, auth.orgId, [claim]);
        if (!view) throw new Error("claim view missing");
        return view;
      },
    }),
    defineRoute({
      method: "post",
      path: "/overtime/:id/withdraw",
      summary: "Withdraw a pending overtime claim",
      access: { permission: "attendance:create" },
      request: { params: id },
      responses: { 200: claimView },
      errors: ["not_found", "conflict"],
      example: { body: {} },
      handler: async ({ c, deps, auth, grant, params }) => {
        const claim = await withdrawClaim(deps, actorOf(c, auth), grant, params.id);
        const [view] = await toClaimViews(deps.db, auth.orgId, [claim]);
        if (!view) throw new Error("claim view missing");
        return view;
      },
    }),
    defineRoute({
      method: "get",
      path: "/timesheets",
      summary: "Timesheet approval for a period: each person you can see, with their status and totals",
      description:
        "The period containing `date` (default today) under the organisation's setting. Employees see themselves, managers their team, owners, HR and payroll admins everyone.",
      access: { permission: "attendance:read" },
      request: { query: z.object({ date: isoDate.optional(), employeeId: z.uuid().optional() }) },
      responses: { 200: overviewView },
      handler: async ({ c, deps, auth, grant, query }) => {
        const settings = await loadAttendanceSettings(deps.db, auth.orgId);
        const now = deps.clock.now();
        const today = todaySg(deps);
        const period = periodOf(query.date ?? today, settings.timesheetPeriod);
        let ids: string[];
        if (query.employeeId) {
          await grant.assertEmployee(query.employeeId, "employee");
          ids = [query.employeeId];
        } else ids = await employeesInScope(deps.db, auth.orgId, grant, period.start, period.end);
        const sheet = await timesheets(deps.db, auth.orgId, ids, period.start, period.end, today);
        const latest = await latestTimesheets(deps.db, auth.orgId, [...sheet.days.keys()], period);
        const views = new Map(
          (await toTimesheetViews(deps.db, auth.orgId, [...latest.values()])).map((v) => [v.employee.id, v]),
        );
        const tasks = await myTasks(
          deps.db,
          auth.orgId,
          auth.membershipId,
          [...latest.values()].flatMap((t) => (t.approvalRequestId ? [t.approvalRequestId] : [])),
        );
        const manager = settings.timesheetSubmitter === "manager";
        const submitGrant = settings.timesheetApproval
          ? await grantOrNull(c, manager ? "attendance:update" : "attendance:create")
          : null;
        const mayReopen = await can(c, "attendance:reopen");
        const over = isPeriodOver(period, now);
        const items: z.input<typeof overviewItem>[] = [];
        for (const [employeeId, days] of sheet.days) {
          const ts = latest.get(employeeId) ?? null;
          const open = ts?.status === "submitted" || ts?.status === "approved";
          const self = employeeId === auth.employeeId;
          const canSubmit =
            over &&
            !open &&
            !!submitGrant &&
            !(manager && self) &&
            days.some((d) => d.dayType !== "not_employed") &&
            (await submitGrant.canAccessEmployee(employeeId));
          items.push({
            employee: { id: employeeId, name: sheet.times.get(employeeId)?.name ?? "" },
            totals: totalsOf(days),
            status: ts?.status ?? "not_submitted",
            timesheet: views.get(employeeId) ?? null,
            taskId:
              ts?.status === "submitted" && ts.approvalRequestId ? (tasks.get(ts.approvalRequestId) ?? null) : null,
            canSubmit,
            canWithdraw: ts?.status === "submitted" && (self || ts.submittedByMembershipId === auth.membershipId),
            canReopen: ts?.status === "approved" && mayReopen && !self,
          });
        }
        items.sort((a, b) => a.employee.name.localeCompare(b.employee.name));
        return {
          settings: timesheetSettingsOf(settings),
          period: withLabel(period),
          previous: withLabel(previousPeriod(period, settings.timesheetPeriod)),
          next: withLabel(nextPeriod(period, settings.timesheetPeriod)),
          over,
          submittableFrom: submittableFrom(period).toISOString(),
          items,
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/timesheets",
      summary: "Submit a period's timesheet for approval (once the period is over)",
      description:
        "Employees submit their own (owners and HR admins on their behalf), or, when the organisation has managers submit, a manager submits their team's. Warns, without blocking, about missing punches and unclaimed overtime.",
      access: { permission: "attendance:read" },
      request: { body: submitInput },
      responses: { 201: submitResult },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, body }) => {
        const settings = await loadAttendanceSettings(deps.db, auth.orgId);
        const r = await submitTimesheet(deps, actorOf(c, auth), settings, body, (p) => authorize(c, p));
        const [view] = await toTimesheetViews(deps.db, auth.orgId, [r.timesheet]);
        if (!view) throw new Error("timesheet view missing");
        return { timesheet: view, warnings: r.warnings };
      },
    }),
    defineRoute({
      method: "get",
      path: "/timesheets/:id",
      summary: "Get a submitted timesheet",
      access: { permission: "attendance:read" },
      request: { params: id },
      responses: { 200: timesheetView },
      errors: ["not_found"],
      handler: async ({ deps, auth, grant, params }) => {
        const ts = await loadTimesheet(deps.db, auth.orgId, params.id);
        await grant.assertEmployee(ts.employeeId, "timesheet");
        const [view] = await toTimesheetViews(deps.db, auth.orgId, [ts]);
        if (!view) throw new Error("timesheet view missing");
        return view;
      },
    }),
    defineRoute({
      method: "post",
      path: "/timesheets/:id/withdraw",
      summary: "Withdraw a timesheet waiting for approval (the employee or whoever submitted it)",
      access: { permission: "attendance:read" },
      request: { params: id },
      responses: { 200: timesheetView },
      errors: ["not_found", "conflict"],
      example: { body: {} },
      handler: async ({ c, deps, auth, grant, params }) => {
        const ts = await withdrawTimesheet(deps, actorOf(c, auth), grant, params.id);
        const [view] = await toTimesheetViews(deps.db, auth.orgId, [ts]);
        if (!view) throw new Error("timesheet view missing");
        return view;
      },
    }),
    defineRoute({
      method: "post",
      path: "/timesheets/:id/reopen",
      summary: "Reopen an approved timesheet (owners and HR admins; never your own)",
      description: "Unlocks the period; it must be submitted and approved again. Audited; the employee is notified.",
      access: { permission: "attendance:reopen" },
      request: { params: id, body: reopenInput },
      responses: { 200: timesheetView },
      errors: ["not_found", "conflict", "self_change_requires_approval"],
      example: { body: { reason: "Missing clock-out on 14 Oct" } },
      handler: async ({ c, deps, auth, grant, params, body }) => {
        const ts = await reopenTimesheet(deps, actorOf(c, auth), grant, params.id, body.reason);
        const [view] = await toTimesheetViews(deps.db, auth.orgId, [ts]);
        if (!view) throw new Error("timesheet view missing");
        return view;
      },
    }),
    defineRoute({
      method: "get",
      path: "/settings",
      summary: "Attendance settings (location, offices, IP ranges, start time, grace, OT rounding)",
      access: { permission: "policies:read" },
      responses: { 200: settingsView },
      handler: async ({ deps, auth }) => toSettingsView(await loadAttendanceSettings(deps.db, auth.orgId)),
    }),
    defineRoute({
      method: "put",
      path: "/settings",
      summary: "Update attendance settings",
      access: { permission: "policies:update" },
      request: { body: settingsInput },
      responses: { 200: settingsView },
      handler: async ({ c, deps, auth, body }) =>
        toSettingsView(await saveAttendanceSettings(deps, auditContext(c), auth.orgId, body)),
    }),
    defineRoute({
      method: "get",
      path: "/reports/summary",
      summary: "Attendance summary per employee for a period (up to 62 days)",
      access: { permission: "reports_attendance:read" },
      request: { query: summaryQuery },
      responses: { 200: z.object({ items: z.array(summaryRow) }) },
      handler: async ({ deps, auth, grant, query }) => ({
        items: await attendanceSummary(deps.db, auth.orgId, grant, query.from, query.to, todaySg(deps)),
      }),
    }),
    defineRoute({
      method: "get",
      path: "/reports/summary.csv",
      summary: "Attendance summary as CSV",
      access: { permission: "reports_attendance:export" },
      request: { query: summaryQuery },
      responses: { 200: { description: "CSV file", contentType: "text/csv" } },
      handler: async ({ deps, auth, grant, query }) => {
        const rows = await attendanceSummary(deps.db, auth.orgId, grant, query.from, query.to, todaySg(deps));
        return new Response(summaryCsv(rows), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="attendance-${query.from}-${query.to}.csv"`,
          },
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/payroll-overtime",
      summary: "Approved overtime per claim for a pay period (payroll's OvertimeSource)",
      access: { permission: "payroll:read" },
      request: { query: z.object({ periodStart: isoDate, periodEnd: isoDate }) },
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              sourceId: z.uuid(),
              employeeId: z.uuid(),
              minutes: z.number(),
              periodStart: z.string(),
              periodEnd: z.string(),
            }),
          ),
        }),
      },
      handler: async ({ deps, auth, query }) => ({
        items: await listApprovedOvertime(deps.db, auth.orgId, query.periodStart, query.periodEnd),
      }),
    }),
  ],
});
