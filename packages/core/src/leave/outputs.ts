import { fundingForDay, type Payer } from "@crowhr/sg-rules";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { employees } from "../db/schema/employees.ts";
import { leaveChildren, leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayName } from "../employees/records.ts";
import type { UnpaidLeaveDay, UnpaidLeaveSource } from "../payroll/ports.ts";
import { loadEmployeesTime } from "./calendar.ts";
import { PER_CHILD_CODES } from "./defaults.ts";
import { entitlementFor } from "./entitlement.ts";

/**
 * What leave hands to other modules (spec "Payroll and government outputs"; design decision 10).
 */

// ---------------------------------------------------------------------------------------------
// Payroll: unpaid leave per date
// ---------------------------------------------------------------------------------------------

/** Payroll's port (`payroll/ports.ts`): approved no-pay and unpaid infant care leave by date. */
export type { UnpaidLeaveDay, UnpaidLeaveSource };

export async function listUnpaidLeave(db: Db, orgId: string, periodStart: string, periodEnd: string) {
  const org = orgScope(db, orgId);
  const rows = await db
    .select({ day: leaveRequestDays, code: leaveTypes.code, name: leaveTypes.name })
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
      org.where(
        leaveRequestDays,
        gte(leaveRequestDays.date, periodStart),
        lte(leaveRequestDays.date, periodEnd),
        eq(leaveTypes.paid, false),
        inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
      ),
    )
    .orderBy(asc(leaveRequestDays.employeeId), asc(leaveRequestDays.date));
  return rows.map(
    (r): UnpaidLeaveDay => ({
      sourceId: r.day.id,
      requestId: r.day.requestId,
      employeeId: r.day.employeeId,
      date: r.day.date,
      // Unpaid types are always held in days (half days → 0.5).
      days: Math.round(r.day.hundredths / 50) / 2,
      leaveTypeCode: r.code,
      leaveTypeName: r.name,
    }),
  );
}

export function leaveUnpaidSource(deps: Pick<AppDeps, "db">): UnpaidLeaveSource {
  return { listUnpaid: (orgId, from, to) => listUnpaidLeave(deps.db, orgId, from, to) };
}

// ---------------------------------------------------------------------------------------------
// Scheduling: LeaveCalendar (add-scheduling design decision 2)
// ---------------------------------------------------------------------------------------------

export interface LeaveCalendarEntry {
  employeeId: string;
  date: string;
  session: "full" | "am" | "pm";
  status: "approved" | "pending";
}

export interface LeaveCalendar {
  entries(orgId: string, employeeIds: readonly string[], from: string, to: string): Promise<LeaveCalendarEntry[]>;
}

export function leaveCalendar(deps: Pick<AppDeps, "db">): LeaveCalendar {
  return {
    async entries(orgId, employeeIds, from, to) {
      if (!employeeIds.length) return [];
      const org = orgScope(deps.db, orgId);
      const rows = await deps.db
        .select({ day: leaveRequestDays, status: leaveRequests.status })
        .from(leaveRequestDays)
        .innerJoin(
          leaveRequests,
          and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
        )
        .where(
          org.where(
            leaveRequestDays,
            inArray(leaveRequestDays.employeeId, [...employeeIds]),
            gte(leaveRequestDays.date, from),
            lte(leaveRequestDays.date, to),
            inArray(leaveRequests.status, ["pending", "approved", "cancellation_pending"]),
          ),
        )
        .orderBy(asc(leaveRequestDays.date));
      return rows.map((r) => ({
        employeeId: r.day.employeeId,
        date: r.day.date,
        session: r.day.session,
        status: r.status === "pending" ? "pending" : "approved",
      }));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Government-paid leave report (manual claims on the MSF GPL portal; no API exists)
// ---------------------------------------------------------------------------------------------

const GOVERNMENT_CODES = [
  "maternity",
  "paternity",
  "shared_parental",
  "adoption",
  "childcare",
  "extended_childcare",
  "ns",
] as const;

export interface GovernmentPaidRow {
  requestId: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  scheme: string;
  child: string | null;
  startDate: string;
  endDate: string;
  days: number;
  employerDays: number;
  governmentDays: number;
  unpaidDays: number;
  /** GPL claims are due within 3 months of the last day of leave; NS make-up pay is automated by MINDEF. */
  claimBy: string | null;
  claimVia: string;
}

function plusMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const i = y * 12 + (m - 1) + months;
  const ny = Math.floor(i / 12);
  const nm = (i % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, dim)).padStart(2, "0")}`;
}

const SCHEME: Record<string, string> = {
  maternity: "Government-Paid Maternity Leave",
  paternity: "Government-Paid Paternity Leave",
  shared_parental: "Shared Parental Leave",
  adoption: "Government-Paid Adoption Leave",
  childcare: "Government-Paid Childcare Leave",
  extended_childcare: "Extended Childcare Leave",
  ns: "NS make-up pay (MINDEF)",
};

/**
 * Approved government-paid leave overlapping [from, to], with each counted day assigned to the
 * employer or the Government by its order within the entitlement (per child, or per year for
 * childcare). Days only: payroll owns the money.
 */
export async function governmentPaidReport(
  db: Db,
  orgId: string,
  from: string,
  to: string,
): Promise<GovernmentPaidRow[]> {
  const org = orgScope(db, orgId);
  const types = (await db.select().from(leaveTypes).where(org.where(leaveTypes))).filter(
    (t) => t.statutoryCode && (GOVERNMENT_CODES as readonly string[]).includes(t.statutoryCode),
  );
  if (!types.length) return [];
  const typeIds = types.map((t) => t.id);
  const requests = await db
    .select()
    .from(leaveRequests)
    .where(
      org.where(
        leaveRequests,
        inArray(leaveRequests.leaveTypeId, typeIds),
        inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
        lte(leaveRequests.startDate, to),
      ),
    )
    .orderBy(asc(leaveRequests.startDate));
  if (!requests.length) return [];
  const empIds = [...new Set(requests.map((r) => r.employeeId))];
  const times = await loadEmployeesTime(db, orgId, empIds);
  const people = await db
    .select()
    .from(employees)
    .where(org.where(employees, inArray(employees.id, empIds)));
  const children = await db
    .select()
    .from(leaveChildren)
    .where(org.where(leaveChildren, inArray(leaveChildren.employeeId, empIds)));
  const days = await db
    .select()
    .from(leaveRequestDays)
    .where(
      org.where(
        leaveRequestDays,
        inArray(
          leaveRequestDays.requestId,
          requests.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(leaveRequestDays.date));
  // Running order of counted days per (employee, type, child or year).
  const used = new Map<string, number>();
  const rows: GovernmentPaidRow[] = [];
  for (const r of requests) {
    const type = types.find((t) => t.id === r.leaveTypeId);
    const t = times.get(r.employeeId);
    if (!type || !t) continue;
    const code = type.statutoryCode as string;
    const perChild = PER_CHILD_CODES.has(code as never);
    const child = r.childId ? (children.find((c) => c.id === r.childId) ?? null) : null;
    const mine = days.filter((d) => d.requestId === r.id);
    let employer = 0;
    let government = 0;
    let unpaid = 0;
    let inRange = 0;
    for (const d of mine) {
      const key = `${r.employeeId}:${code === "childcare" || code === "extended_childcare" ? `${code}:${d.leaveYear}` : `${code}:${r.childId ?? "-"}`}`;
      const start = used.get(key) ?? 0;
      const end = start + d.hundredths / 100;
      used.set(key, end);
      if (d.date < from || d.date > to) continue;
      inRange += d.hundredths / 100;
      let payer: Payer = "government";
      if (code !== "ns") {
        const ent = entitlementFor(t, type, {
          year: d.leaveYear,
          asOf: d.date,
          child,
          children: children.filter((c) => c.employeeId === r.employeeId),
        });
        const segments = ent.funding ?? [];
        try {
          payer = segments.length ? fundingForDay(segments, end) : "employer";
        } catch {
          payer = "employer";
        }
      }
      const q = d.hundredths / 100;
      if (payer === "employer") employer += q;
      else if (payer === "government") government += q;
      else unpaid += q;
    }
    if (inRange === 0) continue;
    const person = people.find((p) => p.id === r.employeeId);
    rows.push({
      requestId: r.id,
      employeeId: r.employeeId,
      employeeName: person ? displayName(person) : t.name,
      leaveType: type.name,
      scheme: SCHEME[code] ?? type.name,
      child: perChild || child ? (child?.name ?? null) : null,
      startDate: r.startDate,
      endDate: r.endDate,
      days: inRange,
      employerDays: employer,
      governmentDays: government,
      unpaidDays: unpaid,
      claimBy: code === "ns" ? null : plusMonths(r.endDate, 3),
      claimVia:
        code === "ns" ? "Automatic (MINDEF uses IRAS and CPF data)" : "MSF Government-Paid Leave portal (Corppass)",
    });
  }
  return rows;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function governmentPaidCsv(rows: GovernmentPaidRow[]): string {
  return toCsv(
    [
      "Employee",
      "Leave type",
      "Scheme",
      "Child",
      "Start",
      "End",
      "Days in period",
      "Employer-paid days",
      "Government-paid days",
      "Unpaid days",
      "Claim by",
      "Claim via",
    ],
    rows.map((r) => [
      r.employeeName,
      r.leaveType,
      r.scheme,
      r.child,
      r.startDate,
      r.endDate,
      r.days,
      r.employerDays,
      r.governmentDays,
      r.unpaidDays,
      r.claimBy,
      r.claimVia,
    ]),
  );
}
