import { z } from "zod";
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
import { punchInput, punchStatus, punchView, recordPunch, toPunchView } from "./punch.ts";
import { assertRange, attendanceSummary, employeesInScope, summaryCsv, summaryQuery, summaryRow } from "./reports.ts";
import {
  DEFAULT_PDPA_NOTICE,
  loadAttendanceSettings,
  saveAttendanceSettings,
  settingsInput,
  settingsView,
  toSettingsView,
} from "./settings.ts";
import { timesheets, totalsOf } from "./timesheet.ts";

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
});

const totals = z.object({
  daysWorked: z.number(),
  workedMinutes: z.number(),
  lateCount: z.number(),
  lateMinutes: z.number(),
  earlyOutCount: z.number(),
  missingPunches: z.number(),
  otMinutes: z.number(),
  leaveDays: z.number(),
});

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
});

const claimResult = z.object({ claim: claimView, warnings: z.array(z.string()) });

const sheetQuery = z.object({ employeeId: z.uuid().optional(), from: isoDate, to: isoDate });

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
      access: { permission: "attendance:update" },
      request: { body: correctionInput },
      responses: { 201: punchView },
      errors: ["not_found", "self_change_requires_approval"],
      handler: async ({ c, deps, auth, grant, body }) =>
        toPunchView(await addCorrection(deps, actorOf(c, auth), grant, body)),
    }),
    defineRoute({
      method: "post",
      path: "/punches/:id/void",
      summary: "Void a wrong punch, with a reason (the original is kept; audited)",
      access: { permission: "attendance:update" },
      request: { params: id, body: voidInput },
      responses: { 200: punchView },
      errors: ["not_found", "conflict", "self_change_requires_approval"],
      example: { body: { reason: "Clocked in twice" } },
      handler: async ({ c, deps, auth, grant, params, body }) =>
        toPunchView(await voidPunch(deps, actorOf(c, auth), grant, params.id, body.reason)),
    }),
    defineRoute({
      method: "post",
      path: "/overtime",
      summary: "Claim overtime for a day (up to the timesheet's OT; warns past 72 hours a month)",
      access: { permission: "attendance:create" },
      request: { body: claimInput },
      responses: { 201: claimResult },
      errors: ["not_found", "conflict"],
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
