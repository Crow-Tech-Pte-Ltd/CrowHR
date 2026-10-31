import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { auditContext } from "../audit/audit.ts";
import type { AppContext, AuthContext } from "../context.ts";
import { leaveChildren, leaveHolidays } from "../db/schema/leave.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { adjustBalance, adjustmentInput, cancelLeave, loadRequest, withdrawLeave } from "./actions.ts";
import {
  addHoliday,
  createCustomType,
  customTypeInput,
  getSettings,
  holidayInput,
  policyUpdate,
  policyView,
  removeHoliday,
  saveSettings,
  setTypeArchived,
  settingsSchema,
  toPolicyView,
  updatePolicy,
} from "./admin.ts";
import { applyLeave, quoteLeave, resolveTargetEmployee, storeAttachments } from "./apply.ts";
import { balancesFor } from "./balances.ts";
import { loadEmployeeTime } from "./calendar.ts";
import { ensureLeaveSetup } from "./defaults.ts";
import { governmentPaidCsv, governmentPaidReport, listUnpaidLeave } from "./outputs.ts";
import { applyInput, attachmentInput, isoDate, type LeaveActor, listTypes, quoteInput } from "./service.ts";
import {
  calendarQuery,
  calendarView,
  childInput,
  childView,
  getRequest,
  holidaysBetween,
  listChildren,
  listRequests,
  readAttachment,
  requestListQuery,
  requestView,
  saveChild,
  teamCalendar,
  toChildView,
  todaySg,
  toTypeView,
  typeView,
} from "./views.ts";

/** HTTP surface of the leave module (`/api/v1/leave`). Thin: services hold the rules. */

function actorOf(c: AppContext, auth: AuthContext): LeaveActor {
  return {
    orgId: auth.orgId,
    membershipId: auth.membershipId,
    employeeId: auth.employeeId,
    roles: auth.roles,
    audit: auditContext(c),
  };
}

const id = z.object({ id: z.uuid() });
const okRequest = { 200: requestView };

const balanceView = z.object({
  typeId: z.uuid(),
  code: z.string(),
  name: z.string(),
  statutoryCode: z.string().nullable(),
  unit: z.enum(["days", "hours"]),
  tracked: z.boolean(),
  eligible: z.boolean(),
  eligibleFrom: z.string().nullable(),
  year: z.number(),
  childId: z.uuid().nullable(),
  entitlement: z.number(),
  carriedForward: z.number(),
  expired: z.number(),
  adjustments: z.number(),
  taken: z.number(),
  pending: z.number(),
  available: z.number().nullable(),
  carryExpiresOn: z.string().nullable(),
  explanation: z.array(z.string()),
});

const quoteView = z.object({
  employeeId: z.uuid(),
  type: typeView,
  unit: z.enum(["days", "hours"]),
  quantity: z.number(),
  days: z.array(
    z.object({
      date: z.string(),
      session: z.enum(["full", "am", "pm"]),
      quantity: z.number(),
      note: z.string().nullable(),
    }),
  ),
  years: z.array(
    z.object({
      year: z.number(),
      quantity: z.number(),
      tracked: z.boolean(),
      available: z.number().nullable(),
      after: z.number().nullable(),
    }),
  ),
  issues: z.array(z.object({ code: z.string(), path: z.string(), message: z.string() })),
  warnings: z.array(z.string()),
  ok: z.boolean(),
});

const toHundredthsView = (n: number | null) => (n === null ? null : n / 100);

async function balancesView(
  c: AppContext,
  auth: AuthContext,
  grant: Grant,
  employeeId: string | undefined,
  year: number | undefined,
) {
  const deps = c.var.deps;
  const target = employeeId ?? auth.employeeId;
  if (!target) {
    throw new AppError(
      "validation_failed",
      "Your sign-in isn't linked to an employee record, so choose the employee.",
      {
        issues: [{ path: "employeeId", message: "Choose the employee." }],
      },
    );
  }
  await grant.assertEmployee(target, "employee");
  const types = await listTypes(deps, auth.orgId);
  const today = todaySg(deps);
  const y = year ?? Number(today.slice(0, 4));
  const asOf =
    y === Number(today.slice(0, 4)) ? today : y < Number(today.slice(0, 4)) ? `${y + 1}-01-01` : `${y}-01-01`;
  const t = await loadEmployeeTime(deps.db, auth.orgId, target);
  const rows = await balancesFor(deps.db, t, types, y, asOf);
  return rows.map((b) => ({
    ...b,
    entitlement: b.entitlement / 100,
    carriedForward: b.carriedForward / 100,
    expired: b.expired / 100,
    adjustments: b.adjustments / 100,
    taken: b.taken / 100,
    pending: b.pending / 100,
    available: toHundredthsView(b.available),
  }));
}

const balancesQuery = z.object({
  employeeId: z.uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
const rangeQuery = z.object({ from: isoDate, to: isoDate });
const periodQuery = z.object({ periodStart: isoDate, periodEnd: isoDate });

const unpaidDayView = z.object({
  sourceId: z.uuid(),
  requestId: z.uuid(),
  employeeId: z.uuid(),
  date: z.string(),
  days: z.number(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
});

const govRowView = z.object({
  requestId: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  leaveType: z.string(),
  scheme: z.string(),
  child: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  days: z.number(),
  employerDays: z.number(),
  governmentDays: z.number(),
  unpaidDays: z.number(),
  claimBy: z.string().nullable(),
  claimVia: z.string(),
});

const holidayView = z.object({
  id: z.uuid().nullable(),
  date: z.string(),
  name: z.string(),
  source: z.enum(["gazetted", "organisation"]),
});

export const leaveModule = defineModule({
  name: "leave",
  basePath: "/leave",
  tag: "Leave",
  feature: "leave",
  routes: [
    defineRoute({
      method: "get",
      path: "/types",
      summary: "List the leave types employees can apply for",
      access: "authenticated",
      responses: { 200: z.object({ items: z.array(typeView) }) },
      handler: async ({ deps, auth }) => ({
        items: (await listTypes(deps, auth.orgId)).filter((t) => !t.archivedAt).map(toTypeView),
      }),
    }),
    defineRoute({
      method: "get",
      path: "/balances",
      summary: "Leave balances for an employee and year (default: your own, this year)",
      access: { permission: "leave:read" },
      request: { query: balancesQuery },
      responses: { 200: z.object({ items: z.array(balanceView) }) },
      handler: async ({ c, auth, grant, query }) => ({
        items: await balancesView(c, auth, grant, query.employeeId, query.year),
      }),
    }),
    defineRoute({
      method: "post",
      path: "/quote",
      summary: "Work out an application without submitting it (days counted, balance before and after)",
      access: { permission: "leave:create" },
      request: { body: quoteInput },
      responses: { 200: quoteView },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, grant, body }) => {
        await ensureLeaveSetup(deps, auth.orgId);
        const employeeId = await resolveTargetEmployee(actorOf(c, auth), grant, body.employeeId);
        const q = await quoteLeave(deps.db, auth.orgId, { ...body, employeeId }, { today: todaySg(deps) });
        return {
          employeeId,
          type: toTypeView(q.type),
          unit: q.unit,
          quantity: q.totalHundredths / 100,
          days: q.days.map((d) => ({ date: d.date, session: d.session, quantity: d.hundredths / 100, note: d.note })),
          years: q.years.map((y) => ({
            year: y.year,
            quantity: y.hundredths / 100,
            tracked: y.tracked,
            available: toHundredthsView(y.available),
            after: toHundredthsView(y.after),
          })),
          issues: q.issues,
          warnings: q.warnings,
          ok: q.issues.length === 0,
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/requests",
      summary: "Apply for leave (your own, or on behalf of an employee as owner or HR admin)",
      access: { permission: "leave:create" },
      request: { body: applyInput },
      responses: { 201: requestView },
      errors: ["not_found", "not_eligible", "insufficient_balance", "leave_overlap"],
      handler: async ({ c, deps, auth, grant, body }) => {
        const actor = actorOf(c, auth);
        const employeeId = await resolveTargetEmployee(actor, grant, body.employeeId);
        const created = await applyLeave(deps, actor, employeeId, body);
        return getRequest(deps.db, auth.orgId, grant, created.id);
      },
    }),
    defineRoute({
      method: "get",
      path: "/requests",
      summary: "List leave requests you can see (yours; your team's; everyone's for admins)",
      access: { permission: "leave:read" },
      request: { query: requestListQuery },
      responses: { 200: z.object({ items: z.array(requestView) }) },
      handler: async ({ deps, auth, grant, query }) => ({
        items: await listRequests(deps.db, auth.orgId, grant, query),
      }),
    }),
    defineRoute({
      method: "get",
      path: "/requests/:id",
      summary: "Get a leave request",
      access: { permission: "leave:read" },
      request: { params: id },
      responses: okRequest,
      errors: ["not_found"],
      handler: async ({ deps, auth, grant, params }) => getRequest(deps.db, auth.orgId, grant, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/requests/:id/withdraw",
      summary: "Withdraw a pending leave request",
      access: { permission: "leave:create" },
      request: { params: id },
      responses: okRequest,
      errors: ["not_found", "conflict"],
      example: { body: {} },
      handler: async ({ c, deps, auth, grant, params }) => {
        await withdrawLeave(deps, actorOf(c, auth), grant, params.id);
        return getRequest(deps.db, auth.orgId, grant, params.id);
      },
    }),
    defineRoute({
      method: "post",
      path: "/requests/:id/cancel",
      summary: "Cancel approved leave (sent for approval; owners and HR admins may cancel directly)",
      access: { permission: "leave:create" },
      request: {
        params: id,
        body: z.object({ reason: z.string().trim().max(300).nullish(), direct: z.boolean().default(false) }),
      },
      responses: okRequest,
      errors: ["not_found", "conflict", "self_change_requires_approval"],
      example: { body: { reason: "Plans changed" } },
      handler: async ({ c, deps, auth, grant, params, body }) => {
        await cancelLeave(deps, actorOf(c, auth), grant, params.id, {
          reason: body.reason ?? null,
          direct: body.direct,
        });
        return getRequest(deps.db, auth.orgId, grant, params.id);
      },
    }),
    defineRoute({
      method: "post",
      path: "/requests/:id/attachments",
      summary: "Attach files (such as an MC) to a pending or approved leave request",
      access: { permission: "leave:create" },
      request: { params: id, body: z.object({ attachments: z.array(attachmentInput).min(1).max(5) }) },
      responses: okRequest,
      errors: ["not_found", "conflict"],
      example: {
        body: { attachments: [{ filename: "mc.pdf", contentType: "application/pdf", dataBase64: "JVBERi0xLjQK" }] },
      },
      handler: async ({ deps, auth, grant, params, body }) => {
        const request = await loadRequest(deps.db, auth.orgId, params.id);
        await grant.assertEmployee(request.employeeId, "leave request");
        if (!["pending", "approved", "cancellation_pending"].includes(request.status)) {
          throw new AppError("conflict", "This request is closed, so files can't be added. Apply again if needed.");
        }
        await deps.db.transaction((tx) =>
          storeAttachments(
            tx,
            deps,
            { orgId: auth.orgId, requestId: request.id, membershipId: auth.membershipId },
            body.attachments,
          ),
        );
        return getRequest(deps.db, auth.orgId, grant, params.id);
      },
    }),
    defineRoute({
      method: "get",
      path: "/requests/:id/attachments/:attachmentId",
      summary: "Download an attachment (requester, approvers, owners and HR admins only: medical)",
      access: { permission: "leave:read" },
      request: { params: z.object({ id: z.uuid(), attachmentId: z.uuid() }) },
      responses: { 200: { description: "The file", contentType: "application/octet-stream" } },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => {
        const { file, data } = await readAttachment(deps, auth, params.id, params.attachmentId);
        const inline = file.contentType.startsWith("image/");
        return new Response(data as BodyInit, {
          headers: {
            "content-type": file.contentType,
            "content-disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/"/g, "")}"`,
            "x-content-type-options": "nosniff",
            "cache-control": "private, no-store",
          },
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/calendar",
      summary: "Who is on leave (types shown only where you may see them)",
      access: { permission: "leave:read" },
      request: { query: calendarQuery },
      responses: { 200: calendarView },
      handler: async ({ deps, auth, grant, query }) => teamCalendar(deps, auth, grant, query),
    }),
    defineRoute({
      method: "get",
      path: "/children",
      summary: "An employee's children (for parental and childcare leave)",
      access: { permission: "leave:read" },
      request: { query: z.object({ employeeId: z.uuid().optional() }) },
      responses: { 200: z.object({ items: z.array(childView) }) },
      handler: async ({ deps, auth, grant, query }) => {
        const employeeId = query.employeeId ?? auth.employeeId;
        if (!employeeId) return { items: [] };
        return { items: (await listChildren(deps.db, auth.orgId, grant, employeeId)).map(toChildView) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/children",
      summary: "Add a child (yours, or an employee's as owner or HR admin)",
      access: { permission: "leave:create" },
      request: { body: childInput },
      responses: { 201: childView },
      handler: async ({ c, deps, auth, grant, body }) =>
        toChildView(await saveChild(deps, actorOf(c, auth), grant, body)),
    }),
    defineRoute({
      method: "put",
      path: "/children/:id",
      summary: "Update a child's details",
      access: { permission: "leave:create" },
      request: { params: id, body: childInput },
      responses: { 200: childView },
      errors: ["not_found"],
      example: { body: { name: "Baby", birthDate: "2026-09-01", isCitizen: true, birthOrder: 1 } },
      handler: async ({ c, deps, auth, grant, params, body }) => {
        const existing = await orgScope(deps.db, auth.orgId).findById(leaveChildren, params.id);
        if (!existing) throw new AppError("not_found", "That child record doesn't exist.");
        return toChildView(
          await saveChild(deps, actorOf(c, auth), grant, { ...body, employeeId: existing.employeeId }, params.id),
        );
      },
    }),
    defineRoute({
      method: "get",
      path: "/holidays",
      summary: "Singapore public holidays and the organisation's extra holidays for a year",
      access: "authenticated",
      request: { query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) },
      responses: { 200: z.object({ items: z.array(holidayView) }) },
      handler: async ({ deps, auth, query }) => {
        const year = query.year ?? Number(todaySg(deps).slice(0, 4));
        const all = await holidaysBetween(deps.db, auth.orgId, `${year}-01-01`, `${year}-12-31`);
        const extra = await deps.db
          .select()
          .from(leaveHolidays)
          .where(orgScope(deps.db, auth.orgId).where(leaveHolidays));
        return {
          items: all.map((h) => {
            const own = extra.find((e) => e.date === h.date && e.name === h.name);
            return {
              id: own?.id ?? null,
              date: h.date,
              name: h.name,
              source: own ? ("organisation" as const) : ("gazetted" as const),
            };
          }),
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/holidays",
      summary: "Add an extra public holiday (such as Polling Day)",
      access: { permission: "policies:update" },
      request: { body: holidayInput },
      responses: { 201: holidayView },
      errors: ["conflict"],
      handler: async ({ c, deps, auth, body }) => {
        const row = await addHoliday(deps, actorOf(c, auth), body);
        return { id: row?.id ?? null, date: body.date, name: body.name, source: "organisation" as const };
      },
    }),
    defineRoute({
      method: "delete",
      path: "/holidays/:id",
      summary: "Remove an extra holiday",
      access: { permission: "policies:update" },
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        await removeHoliday(deps, actorOf(c, auth), params.id);
      },
    }),
    defineRoute({
      method: "get",
      path: "/policies",
      summary: "Leave types with their policies (Settings → Leave policies)",
      access: { permission: "policies:read" },
      responses: { 200: z.object({ items: z.array(policyView) }) },
      handler: async ({ deps, auth }) => ({ items: (await listTypes(deps, auth.orgId)).map(toPolicyView) }),
    }),
    defineRoute({
      method: "post",
      path: "/policies",
      summary: "Add a company leave type (birthday, marriage, volunteering…)",
      access: { permission: "policies:update" },
      request: { body: customTypeInput },
      responses: { 201: policyView },
      errors: ["conflict"],
      handler: async ({ c, deps, auth, body }) => toPolicyView(await createCustomType(deps, actorOf(c, auth), body)),
    }),
    defineRoute({
      method: "patch",
      path: "/policies/:id",
      summary: "Update a leave type's policy (never below the statutory minimum)",
      access: { permission: "policies:update" },
      request: { params: id, body: policyUpdate },
      responses: { 200: policyView },
      errors: ["not_found", "below_statutory"],
      example: { body: { name: "Annual leave" } },
      handler: async ({ c, deps, auth, params, body }) =>
        toPolicyView(await updatePolicy(deps, actorOf(c, auth), params.id, body)),
    }),
    defineRoute({
      method: "post",
      path: "/policies/:id/archive",
      summary: "Archive or restore a company leave type",
      access: { permission: "policies:update" },
      request: { params: id, body: z.object({ archived: z.boolean() }) },
      responses: { 200: policyView },
      errors: ["not_found", "below_statutory"],
      example: { body: { archived: true } },
      handler: async ({ c, deps, auth, params, body }) =>
        toPolicyView(await setTypeArchived(deps, actorOf(c, auth), params.id, body.archived)),
    }),
    defineRoute({
      method: "get",
      path: "/settings",
      summary: "Leave settings (holidays on off days, no-pay leave and service, part-time reference)",
      access: { permission: "policies:read" },
      responses: { 200: settingsSchema },
      handler: async ({ deps, auth }) => getSettings(deps, auth.orgId),
    }),
    defineRoute({
      method: "put",
      path: "/settings",
      summary: "Update leave settings",
      access: { permission: "policies:update" },
      request: { body: settingsSchema },
      responses: { 200: settingsSchema },
      handler: async ({ c, deps, auth, body }) => saveSettings(deps, actorOf(c, auth), body),
    }),
    defineRoute({
      method: "post",
      path: "/adjustments",
      summary: "Adjust an employee's balance (positive or negative, with a reason; audited)",
      access: { permission: "leave:update" },
      request: { body: adjustmentInput },
      responses: { 201: z.object({ id: z.uuid(), quantity: z.number(), unit: z.enum(["days", "hours"]) }) },
      errors: ["not_found", "self_change_requires_approval"],
      handler: async ({ c, deps, auth, grant, body }) => {
        const r = await adjustBalance(deps, actorOf(c, auth), grant, body);
        return { id: r.id, quantity: r.hundredths / 100, unit: r.unit };
      },
    }),
    defineRoute({
      method: "get",
      path: "/reports/government-paid",
      summary: "Government-paid leave days to claim on the MSF portal (and NS make-up pay)",
      access: { permission: "leave_claims:read" },
      request: { query: rangeQuery },
      responses: { 200: z.object({ items: z.array(govRowView) }) },
      handler: async ({ deps, auth, query }) => ({
        items: await governmentPaidReport(deps.db, auth.orgId, query.from, query.to),
      }),
    }),
    defineRoute({
      method: "get",
      path: "/reports/government-paid.csv",
      summary: "Government-paid leave days as CSV",
      access: { permission: "leave_claims:read" },
      request: { query: rangeQuery },
      responses: { 200: { description: "CSV file", contentType: "text/csv" } },
      handler: async ({ deps, auth, query }) => {
        const csv = governmentPaidCsv(await governmentPaidReport(deps.db, auth.orgId, query.from, query.to));
        return new Response(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="government-paid-leave-${query.from}-${query.to}.csv"`,
          },
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/payroll-input",
      summary: "Approved unpaid leave per employee and date for a pay period (payroll pro-ration)",
      access: { permission: "payroll:read" },
      request: { query: periodQuery },
      responses: { 200: z.object({ items: z.array(unpaidDayView) }) },
      handler: async ({ deps, auth, query }) => ({
        items: await listUnpaidLeave(deps.db, auth.orgId, query.periodStart, query.periodEnd),
      }),
    }),
  ],
});
