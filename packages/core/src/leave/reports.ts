import { dailyRate, roundHalfUpToCent } from "@crowhr/sg-rules";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { compensationRecords, employees } from "../db/schema/employees.ts";
import { leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import { displayDate, isIsoDate } from "../employees/dates.ts";
import { asAtMany } from "../employees/effective.ts";
import { displayName } from "../employees/records.ts";
import { membersOn } from "../employees/reports/people-data.ts";
import {
  inBatches,
  MAX_REPORT_ROWS,
  type ReportColumn,
  type ReportContext,
  type ReportDefinition,
  type ReportRow,
  type ReportSource,
  reportPageNumber,
} from "../reporting/types.ts";
import { balancesFor, loadBalanceFacts } from "./balances.ts";
import { loadEmployeesTime, workingDaysPerWeekOn } from "./calendar.ts";
import { ensureLeaveSetup } from "./defaults.ts";
import { governmentPaidReport } from "./outputs.ts";

/**
 * Leave reports (add-reporting spec "Module reports through definitions": leave balances as at a
 * date and leave taken by type and department). Readers: owner, hr_admin (organisation) and
 * managers (their team), `reports_leave:*`. The liability column is salary-class: it needs
 * compensation access for every employee in the report.
 */

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-10-31." });

const days = (hundredths: number) => Math.round(hundredths) / 100;

const takenParams = ({ today }: { today: string }) =>
  z
    .object({
      from: isoDate.default(`${today.slice(0, 4)}-01-01`),
      to: isoDate.default(today),
      by: z.enum(["type", "department", "employee"]).default("department"),
    })
    .refine((p) => p.from <= p.to, { message: "Pick a start date on or before the end date.", path: ["from"] });

/** Department in force on the leave day (people's employment records). */
const DEPT = sql`(select d.name from employment_records er join departments d on d.org_id = er.org_id and d.id = er.department_id
                   where er.org_id = ${leaveRequestDays.orgId} and er.employee_id = ${leaveRequestDays.employeeId}
                     and er.effective_from <= ${leaveRequestDays.date}
                   order by er.effective_from desc limit 1)`;

export const leaveTakenReport: ReportDefinition<z.output<ReturnType<typeof takenParams>>> = {
  id: "leave.taken",
  module: "leave",
  title: "Leave taken",
  description: "Approved leave taken in a period by type, department or employee.",
  read: "reports_leave:read",
  export: "reports_leave:export",
  params: takenParams,
  fields: [
    { key: "from", label: "From", kind: "date" },
    { key: "to", label: "To", kind: "date" },
    {
      key: "by",
      label: "Group by",
      kind: "select",
      options: [
        { value: "type", label: "Leave type" },
        { value: "department", label: "Department and type" },
        { value: "employee", label: "Employee and type" },
      ],
    },
  ],
  columns: (p) => [
    ...(p.by === "department" ? [{ key: "department", title: "Department", type: "text" as const }] : []),
    ...(p.by === "employee" ? [{ key: "employee", title: "Employee", type: "text" as const }] : []),
    { key: "leaveType", title: "Leave type", type: "text" },
    { key: "unit", title: "Unit", type: "text" },
    { key: "people", title: "Employees", type: "integer" },
    { key: "taken", title: "Taken", type: "decimal", total: "sum" },
  ],
  defaultSort: { key: "taken", dir: "desc" },
  async *run(ctx, p) {
    if (ctx.employeeIds && ctx.employeeIds.size === 0) return;
    const department = sql<string>`coalesce(${DEPT}, 'No department')`;
    const group = p.by === "department" ? department : p.by === "employee" ? leaveRequestDays.employeeId : null;
    const rows = await ctx.db
      .select({
        department: p.by === "department" ? department : sql<null>`null`,
        employeeName:
          p.by === "employee"
            ? sql<string>`min((select e.legal_name from employees e where e.org_id = ${leaveRequestDays.orgId} and e.id = ${leaveRequestDays.employeeId}))`
            : sql<null>`null`,
        leaveType: leaveTypes.name,
        unit: leaveRequests.unit,
        people: sql<number>`count(distinct ${leaveRequestDays.employeeId})`.mapWith(Number),
        hundredths: sql<number>`sum(${leaveRequestDays.hundredths})`.mapWith(Number),
      })
      .from(leaveRequestDays)
      .innerJoin(
        leaveRequests,
        and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
      )
      .innerJoin(
        leaveTypes,
        and(eq(leaveTypes.orgId, leaveRequestDays.orgId), eq(leaveTypes.id, leaveRequestDays.leaveTypeId)),
      )
      .where(
        orgScope(ctx.db, ctx.orgId).where(
          leaveRequestDays,
          inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
          gte(leaveRequestDays.date, p.from),
          lte(leaveRequestDays.date, p.to),
          ctx.employeeIds ? inArray(leaveRequestDays.employeeId, [...ctx.employeeIds]) : undefined,
        ),
      )
      .groupBy(leaveTypes.name, leaveRequests.unit, ...(group ? [group] : []));
    yield* inBatches(
      rows.map((r) => ({
        ...(p.by === "department" ? { department: r.department } : {}),
        ...(p.by === "employee" ? { employee: r.employeeName } : {}),
        leaveType: r.leaveType,
        unit: r.unit === "hours" ? "Hours" : "Days",
        people: r.people,
        taken: days(r.hundredths),
      })),
    );
  },
  emptyMessage: (p) =>
    `No approved leave was taken between ${displayDate(p.from)} and ${displayDate(p.to)}. Widen the dates.`,
  notes: ["Counts approved leave days in the period (half days as 0.5). Departments are as on each leave day."],
  chart: { label: "leaveType", value: "taken" },
};

const balanceParams = ({ today }: { today: string }) =>
  z.object({ asAt: isoDate.default(today), type: z.enum(["annual", "all"]).default("annual") });

export const leaveBalancesReport: ReportDefinition<z.output<ReturnType<typeof balanceParams>>> = {
  id: "leave.balances",
  module: "leave",
  title: "Leave balances and liability",
  description: "Entitlement, taken, pending and available leave as at a date, with the annual leave liability.",
  read: "reports_leave:read",
  export: "reports_leave:export",
  params: balanceParams,
  fields: [
    { key: "asAt", label: "As at", kind: "date" },
    {
      key: "type",
      label: "Leave types",
      kind: "select",
      options: [
        { value: "annual", label: "Annual leave" },
        { value: "all", label: "Every tracked type" },
      ],
    },
  ],
  columns: () => [
    { key: "employeeNumber", title: "Employee no.", type: "text" },
    { key: "name", title: "Employee", type: "text" },
    { key: "department", title: "Department", type: "text" },
    { key: "leaveType", title: "Leave type", type: "text" },
    // Part-timers' leave is kept in hours (Part-Time Employment Regulations), everyone else's in days.
    { key: "unit", title: "Unit", type: "text" },
    { key: "entitlement", title: "Entitlement", type: "decimal", total: "sum" },
    { key: "carriedForward", title: "Carried forward", type: "decimal", total: "sum" },
    { key: "taken", title: "Taken", type: "decimal", total: "sum" },
    { key: "pending", title: "Pending", type: "decimal", total: "sum" },
    { key: "available", title: "Available", type: "decimal", total: "sum" },
    { key: "liability", title: "Liability (S$)", type: "money_cents", total: "sum", sensitivity: "salary" },
  ],
  defaultSort: { key: "name", dir: "asc" },
  async *run(ctx, p) {
    await ensureLeaveSetup(ctx.deps, ctx.orgId);
    const members = await membersOn(ctx.db, ctx.orgId, p.asAt, ctx.employeeIds);
    if (!members.length) return;
    const types = (await ctx.db.select().from(leaveTypes).where(eq(leaveTypes.orgId, ctx.orgId))).filter(
      (t) => !t.archivedAt && (p.type === "all" || t.code === "annual"),
    );
    const times = await loadEmployeesTime(
      ctx.db,
      ctx.orgId,
      members.map((m) => m.employeeId),
    );
    const pay =
      (ctx.visibleColumns?.has("liability") ?? true)
        ? await asAtMany(
            ctx.db,
            compensationRecords,
            ctx.orgId,
            members.map((m) => m.employeeId),
            p.asAt,
          )
        : null;
    const year = Number(p.asAt.slice(0, 4));
    for (let i = 0; i < members.length; i += 100) {
      const out: ReportRow[] = [];
      const batch = members.slice(i, i + 100);
      const facts = await loadBalanceFacts(
        ctx.db,
        ctx.orgId,
        batch.map((m) => m.employeeId),
        year,
        p.asAt,
      );
      for (const m of batch) {
        const t = times.get(m.employeeId);
        if (!t) continue;
        for (const b of await balancesFor(ctx.db, t, types, year, p.asAt, facts)) {
          if (!b.tracked || !b.eligible) continue;
          const comp = pay?.get(m.employeeId);
          let liability: number | null = null;
          if (b.code === "annual" && b.unit === "days" && comp?.payBasis === "monthly" && b.available !== null) {
            // Annual leave liability = available days × daily basic rate (12 × monthly basic ÷ (52 × days per week)).
            const rate = dailyRate({
              monthlyCents: comp.amountCents,
              workingDaysPerWeek: workingDaysPerWeekOn(t, p.asAt),
              kind: "basic",
            });
            liability = roundHalfUpToCent({
              n: rate.exact.n * BigInt(Math.max(0, b.available)),
              d: rate.exact.d * 100n,
            });
          }
          out.push({
            employeeNumber: m.employeeNumber,
            name: m.name,
            department: m.department,
            leaveType: b.childId ? `${b.name} (per child)` : b.name,
            unit: b.unit === "hours" ? "Hours" : "Days",
            entitlement: days(b.entitlement),
            carriedForward: days(b.carriedForward),
            taken: days(b.taken),
            pending: days(b.pending),
            available: b.available === null ? null : days(b.available),
            liability,
          });
        }
      }
      yield out;
    }
  },
  emptyMessage: (p) => `Nobody in this report was employed on ${displayDate(p.asAt)}. Pick another date.`,
  notes: [
    "Liability values available annual leave at the daily basic rate (12 × monthly basic ÷ (52 × working days a week), Employment Act); hourly and daily-rated employees show no liability.",
    "Balances are for the leave year of the date, including pending requests as not yet available.",
  ],
};

const periodParams = ({ today }: { today: string }) =>
  z
    .object({ from: isoDate.default(`${today.slice(0, 4)}-01-01`), to: isoDate.default(today) })
    .refine((p) => p.from <= p.to, { message: "Pick a start date on or before the end date.", path: ["from"] });

const periodFields = [
  { key: "from", label: "From", kind: "date" },
  { key: "to", label: "To", kind: "date" },
] as const;

const requestColumns: ReportColumn[] = [
  { key: "name", title: "Employee", type: "text" },
  { key: "leaveType", title: "Leave type", type: "text" },
  { key: "startDate", title: "Start", type: "date" },
  { key: "endDate", title: "End", type: "date" },
];

type Period = z.output<ReturnType<typeof periodParams>>;
const requestSortColumns = new Map<string, AnyPgColumn>([
  ["startDate", leaveRequests.startDate],
  ["endDate", leaveRequests.endDate],
  ["amount", leaveRequests.hundredths],
]);

function requestFilter(ctx: Pick<ReportContext, "orgId" | "employeeIds">, db: Db, p: Period) {
  return orgScope(db, ctx.orgId).where(
    leaveRequests,
    lte(leaveRequests.startDate, p.to),
    gte(leaveRequests.endDate, p.from),
    ctx.employeeIds ? inArray(leaveRequests.employeeId, [...ctx.employeeIds]) : undefined,
  );
}

function requestedLeaveRows(db: Db, filter: ReturnType<typeof requestFilter>) {
  return db
    .select({
      legalName: employees.legalName,
      preferredName: employees.preferredName,
      employeeNumber: employees.employeeNumber,
      leaveType: leaveTypes.name,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      startSession: leaveRequests.startSession,
      endSession: leaveRequests.endSession,
      status: leaveRequests.status,
      unit: leaveRequests.unit,
      hundredths: leaveRequests.hundredths,
    })
    .from(leaveRequests)
    .innerJoin(employees, and(eq(employees.orgId, leaveRequests.orgId), eq(employees.id, leaveRequests.employeeId)))
    .innerJoin(leaveTypes, and(eq(leaveTypes.orgId, leaveRequests.orgId), eq(leaveTypes.id, leaveRequests.leaveTypeId)))
    .where(filter);
}

type RequestedLeaveRow = Awaited<ReturnType<typeof requestedLeaveRows>>[number];
function toRequestedLeaveRow({ hundredths, legalName, preferredName, ...row }: RequestedLeaveRow): ReportRow {
  return { ...row, name: displayName({ legalName, preferredName }), amount: days(hundredths) };
}

const leaveRequestsReport: ReportDefinition<z.output<ReturnType<typeof periodParams>>> = {
  id: "leave.requests",
  module: "leave",
  title: "Leave requests",
  description: "Individual requests, dates, half-day sessions, units and decision status.",
  read: "reports_leave:read",
  export: "reports_leave:export",
  params: periodParams,
  fields: periodFields,
  columns: () => [
    ...requestColumns,
    { key: "employeeNumber", title: "Employee number", type: "text" },
    { key: "status", title: "Status", type: "text" },
    { key: "startSession", title: "Start session", type: "text" },
    { key: "endSession", title: "End session", type: "text" },
    { key: "amount", title: "Requested amount", type: "decimal" },
    { key: "unit", title: "Unit", type: "text" },
  ],
  defaultSort: { key: "startDate", dir: "desc" },
  async *run(ctx, p) {
    if (ctx.employeeIds?.size === 0) return;
    const rows = await requestedLeaveRows(ctx.db, requestFilter(ctx, ctx.db, p))
      .orderBy(asc(leaveRequests.id))
      .limit(MAX_REPORT_ROWS + 1);
    yield* inBatches(rows.map(toRequestedLeaveRow));
  },
  async readPage(ctx, p, { sort, page, pageSize, maxRows }) {
    const column = requestSortColumns.get(sort.key);
    if (!column) return null;
    if (ctx.employeeIds?.size === 0) return { rows: [], totalRows: 0 };
    const order = sort.dir === "asc" ? asc : desc;
    // A concurrent edit must not shift rows between the count and the page. Required
    // employee/type foreign keys make the simpler count equivalent to the joined selection.
    return ctx.db.transaction(
      async (db) => {
        const filter = requestFilter(ctx, db, p);
        const matching = db
          .select({ id: leaveRequests.id })
          .from(leaveRequests)
          .where(filter)
          .limit(maxRows + 1)
          .as("matching");
        const [result] = await db.select({ totalRows: count() }).from(matching);
        const totalRows = result?.totalRows ?? 0;
        if (!totalRows || totalRows > maxRows) return { rows: [], totalRows };
        const offset = (reportPageNumber(page, totalRows, pageSize) - 1) * pageSize;
        const rows = await requestedLeaveRows(db, filter)
          .orderBy(order(column), asc(leaveRequests.id))
          .limit(pageSize)
          .offset(offset);
        return { rows: rows.map(toRequestedLeaveRow), totalRows };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  emptyMessage: () => "No leave requests overlap these dates. Widen the date range.",
  notes: ["Amounts are for the whole request, including any days outside the selected dates."],
};

const governmentPaidLeaveReport: ReportDefinition<z.output<ReturnType<typeof periodParams>>> = {
  id: "leave.government_paid",
  module: "leave",
  title: "Government-paid leave",
  description: "Government-paid and employer-paid days, claim deadlines and claim routes.",
  read: "leave_claims:read",
  export: "leave_claims:read",
  scopes: ["all"],
  params: periodParams,
  fields: periodFields,
  columns: () => [
    ...requestColumns,
    { key: "scheme", title: "Scheme", type: "text" },
    { key: "days", title: "Days in period", type: "decimal" },
    { key: "employerDays", title: "Employer-paid days", type: "decimal" },
    { key: "governmentDays", title: "Government-paid days", type: "decimal" },
    { key: "unpaidDays", title: "Unpaid days", type: "decimal" },
    { key: "claimBy", title: "Claim by", type: "date" },
    { key: "claimVia", title: "Claim via", type: "text" },
  ],
  defaultSort: { key: "startDate", dir: "desc" },
  async *run({ db, orgId, employeeIds }, p) {
    if (employeeIds?.size === 0) return;
    const rows = await governmentPaidReport(db, orgId, p.from, p.to);
    yield* inBatches(
      rows
        .filter((row) => !employeeIds || employeeIds.has(row.employeeId))
        .map(
          ({
            employeeName,
            leaveType,
            startDate,
            endDate,
            scheme,
            days,
            employerDays,
            governmentDays,
            unpaidDays,
            claimBy,
            claimVia,
          }) => ({
            name: employeeName,
            leaveType,
            startDate,
            endDate,
            scheme,
            days,
            employerDays,
            governmentDays,
            unpaidDays,
            claimBy,
            claimVia,
          }),
        ),
    );
  },
  emptyMessage: () => "No government-paid leave was found in these dates. Widen the date range.",
};

export const leaveReportSource: ReportSource = {
  module: "leave",
  reports: [leaveTakenReport, leaveBalancesReport, leaveRequestsReport, governmentPaidLeaveReport],
};
