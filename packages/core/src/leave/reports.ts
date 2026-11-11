import { dailyRate, roundHalfUpToCent } from "@crowhr/sg-rules";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { compensationRecords } from "../db/schema/employees.ts";
import { leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import { displayDate, isIsoDate } from "../employees/dates.ts";
import { asAtMany } from "../employees/effective.ts";
import { membersOn } from "../employees/reports/people-data.ts";
import { inBatches, type ReportDefinition, type ReportRow, type ReportSource } from "../reporting/types.ts";
import { balancesFor, loadBalanceFacts } from "./balances.ts";
import { loadEmployeesTime, workingDaysPerWeekOn } from "./calendar.ts";
import { ensureLeaveSetup } from "./defaults.ts";

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
    const rows = await ctx.db
      .select({
        department: sql<string | null>`${DEPT}`,
        employeeId: leaveRequestDays.employeeId,
        typeName: leaveTypes.name,
        unit: leaveRequests.unit,
        hundredths: leaveRequestDays.hundredths,
        employeeName: sql<string>`(select e.legal_name from employees e where e.org_id = ${leaveRequestDays.orgId} and e.id = ${leaveRequestDays.employeeId})`,
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
        and(
          eq(leaveRequestDays.orgId, ctx.orgId),
          inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
          sql`${leaveRequestDays.date} >= ${p.from}`,
          sql`${leaveRequestDays.date} <= ${p.to}`,
          ctx.employeeIds ? inArray(leaveRequestDays.employeeId, [...ctx.employeeIds]) : undefined,
        ),
      );
    const groups = new Map<string, { row: ReportRow; people: Set<string>; hundredths: number }>();
    for (const r of rows) {
      const dept = r.department ?? "No department";
      const key = [p.by === "department" ? dept : "", p.by === "employee" ? r.employeeId : "", r.typeName, r.unit].join(
        "|",
      );
      const g = groups.get(key) ?? {
        row: {
          ...(p.by === "department" ? { department: dept } : {}),
          ...(p.by === "employee" ? { employee: r.employeeName } : {}),
          leaveType: r.typeName,
          unit: r.unit === "hours" ? "Hours" : "Days",
        },
        people: new Set<string>(),
        hundredths: 0,
      };
      g.people.add(r.employeeId);
      g.hundredths += r.hundredths;
      groups.set(key, g);
    }
    yield* inBatches([...groups.values()].map((g) => ({ ...g.row, people: g.people.size, taken: days(g.hundredths) })));
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
    const pay = await asAtMany(
      ctx.db,
      compensationRecords,
      ctx.orgId,
      members.map((m) => m.employeeId),
      p.asAt,
    );
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
          const comp = pay.get(m.employeeId);
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

export const leaveReportSource: ReportSource = { module: "leave", reports: [leaveTakenReport, leaveBalancesReport] };
