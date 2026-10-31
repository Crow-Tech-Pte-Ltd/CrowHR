import { z } from "zod";
import { compensationRecords } from "../../db/schema/employees.ts";
import { WORK_PASS_TYPES } from "../../organisation/statutory.ts";
import { inBatches, type ReportDefinition, type ReportRow, type ReportSource } from "../../reporting/types.ts";
import { addDays, daysBetween, displayDate, isIsoDate } from "../dates.ts";
import { asAtMany } from "../effective.ts";
import { passState } from "../work-pass.ts";
import { type HeadcountMember, membersOn, passesExpiring, tenureEventsBetween } from "./people-data.ts";

/**
 * People reports (add-reporting specs "Headcount report", "Joiners, leavers and turnover", tasks
 * 3.1–3.3), contributed to reporting as a `ReportSource`. Readers: owners and hr_admins
 * (`reports_people:*`); the work-pass expiry list follows `work_pass:read` at organisation scope
 * (owner, hr_admin, payroll_admin).
 */

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-10-31." });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the month format YYYY-MM, like 2026-10.");

export const HEADCOUNT_DIMENSIONS = ["department", "location", "employment_type", "residency", "pass_type"] as const;
type Dimension = (typeof HEADCOUNT_DIMENSIONS)[number];

const DIMENSION_LABEL: Record<Dimension, string> = {
  department: "Department",
  location: "Location",
  employment_type: "Employment type",
  residency: "Residency",
  pass_type: "Work pass",
};

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  intern: "Intern",
};
const RESIDENCY_LABEL: Record<string, string> = {
  citizen: "Singapore Citizen",
  pr: "Permanent Resident",
  foreigner: "Foreigner",
};

export function groupLabel(m: HeadcountMember, by: Dimension): string {
  switch (by) {
    case "department":
      return m.department;
    case "location":
      return m.location ?? "No location";
    case "employment_type":
      return EMPLOYMENT_TYPE_LABEL[m.employmentType] ?? m.employmentType;
    case "residency":
      return RESIDENCY_LABEL[m.residency] ?? m.residency;
    case "pass_type":
      return m.passType ? (WORK_PASS_TYPES.find((t) => t.code === m.passType)?.label ?? m.passType) : "No work pass";
  }
}

/** Integer percentage in tenths, rounded half-up: part ÷ whole × 100 to 1 decimal place. */
export function tenthsOfPercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.floor((2 * part * 1000 + whole) / (2 * whole));
}

/**
 * Turnover rate = leavers ÷ ((headcount at start + headcount at end) ÷ 2) × 100, half-up to 1 place
 * (spec "Joiners, leavers and turnover"); null ("n/a") when the average headcount is 0.
 */
export function turnoverTenths(leavers: number, start: number, end: number): number | null {
  const d = start + end;
  if (d === 0) return null;
  // leavers × 2000 / d, rounded half-up = floor((2n + d) / 2d).
  return Math.floor((2 * leavers * 2000 + d) / (2 * d));
}

const dimensionField = {
  key: "by",
  label: "Group by",
  kind: "select" as const,
  options: HEADCOUNT_DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABEL[d] })),
};

const headcountParams = ({ today }: { today: string }) =>
  z.object({
    asAt: isoDate.default(today),
    by: z
      .enum(HEADCOUNT_DIMENSIONS, {
        message: "Group by department, location, employment type, residency or work pass.",
      })
      .default("department"),
  });

export const headcountReport: ReportDefinition<z.output<ReturnType<typeof headcountParams>>> = {
  id: "people.headcount",
  module: "employees",
  title: "Headcount",
  description: "Employees on the books on a date, by department, location, employment type, residency or work pass.",
  read: "reports_people:read",
  export: "reports_people:export",
  params: headcountParams,
  fields: [{ key: "asAt", label: "As at", kind: "date" }, dimensionField],
  columns: (p) => [
    { key: "group", title: DIMENSION_LABEL[p.by], type: "text" },
    { key: "headcount", title: "Headcount", type: "integer", total: "sum" },
    { key: "share", title: "% of total", type: "percent" },
    {
      key: "basicPay",
      title: "Monthly basic pay (S$)",
      type: "money_cents",
      total: "sum",
      sensitivity: "salary",
      optional: true,
    },
  ],
  defaultSort: { key: "headcount", dir: "desc" },
  async *run(ctx, p) {
    const members = await membersOn(ctx.db, ctx.orgId, p.asAt, ctx.employeeIds);
    const pay = await asAtMany(
      ctx.db,
      compensationRecords,
      ctx.orgId,
      members.map((m) => m.employeeId),
      p.asAt,
    );
    const groups = new Map<string, { count: number; pay: number }>();
    for (const m of members) {
      const g = groupLabel(m, p.by);
      const cur = groups.get(g) ?? { count: 0, pay: 0 };
      cur.count++;
      const c = pay.get(m.employeeId);
      if (c?.payBasis === "monthly") cur.pay += c.amountCents;
      groups.set(g, cur);
    }
    const rows: ReportRow[] = [...groups].map(([group, g]) => ({
      group,
      headcount: g.count,
      share: tenthsOfPercent(g.count, members.length),
      basicPay: g.pay,
    }));
    yield* inBatches(rows);
  },
  emptyMessage: (p) => `No employees were on the books on ${displayDate(p.asAt)}. Pick a later date.`,
  notes: [
    "Counts employees whose start date is on or before the date and whose last working day, if any, is on or after it.",
    "Monthly basic pay sums monthly-rated employees only; hourly and daily rates are left out.",
  ],
  chart: { label: "group", value: "headcount" },
};

function monthEnd(m: string): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

const trendParams = ({ today }: { today: string }) =>
  z
    .object({
      from: month.default(`${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}`),
      to: month.default(today.slice(0, 7)),
      by: z.enum(["all", ...HEADCOUNT_DIMENSIONS]).default("all"),
    })
    .refine((p) => p.from <= p.to, { message: "Pick a start month on or before the end month.", path: ["from"] })
    .refine((p) => monthsBetween(p.from, p.to).length <= 36, {
      message: "Choose at most 36 months at a time.",
      path: ["to"],
    });

export const headcountTrendReport: ReportDefinition<z.output<ReturnType<typeof trendParams>>> = {
  id: "people.headcount_trend",
  module: "employees",
  title: "Headcount over time",
  description: "Headcount at the end of each month, with joiners and leavers in the month.",
  read: "reports_people:read",
  export: "reports_people:export",
  params: trendParams,
  fields: [
    { key: "from", label: "From month", kind: "month" },
    { key: "to", label: "To month", kind: "month" },
    { ...dimensionField, options: [{ value: "all", label: "Whole company" }, ...dimensionField.options] },
  ],
  columns: (p) => [
    { key: "month", title: "Month", type: "text" },
    ...(p.by === "all" ? [] : [{ key: "group", title: DIMENSION_LABEL[p.by], type: "text" as const }]),
    { key: "headcount", title: "Headcount at month end", type: "integer" },
    { key: "joiners", title: "Joiners", type: "integer", total: "sum" },
    { key: "leavers", title: "Leavers", type: "integer", total: "sum" },
  ],
  defaultSort: { key: "month", dir: "asc" },
  async *run(ctx, p) {
    for (const m of monthsBetween(p.from, p.to)) {
      const end = monthEnd(m);
      const members = await membersOn(ctx.db, ctx.orgId, end, ctx.employeeIds);
      const events = await tenureEventsBetween(ctx.db, ctx.orgId, `${m}-01`, end, ctx.employeeIds);
      const label = m;
      // Months before anyone was employed (and with nobody joining or leaving) have no row.
      if (!members.length && !events.length) continue;
      if (p.by === "all") {
        yield [
          {
            month: label,
            headcount: members.length,
            joiners: events.filter((e) => e.kind === "joiner").length,
            leavers: events.filter((e) => e.kind === "leaver").length,
          },
        ];
        continue;
      }
      const by = p.by;
      const groups = new Map<string, number>();
      for (const mem of members) groups.set(groupLabel(mem, by), (groups.get(groupLabel(mem, by)) ?? 0) + 1);
      const rows: ReportRow[] = [...groups].map(([group, headcount]) => ({
        month: label,
        group,
        headcount,
        joiners:
          by === "department" ? events.filter((e) => e.kind === "joiner" && e.department === group).length : null,
        leavers:
          by === "department" ? events.filter((e) => e.kind === "leaver" && e.department === group).length : null,
      }));
      yield rows;
    }
  },
  emptyMessage: (p) => `No employees between ${p.from} and ${p.to}. Widen the months.`,
  notes: ["Joiners and leavers per group are shown when grouping by department (the department on the day)."],
  chart: { label: "month", value: "headcount" },
};

const VOLUNTARY = new Set(["resignation", "retirement"]);
const INVOLUNTARY = new Set(["dismissal", "retrenchment", "contract_end"]);
const REASON_LABEL: Record<string, string> = {
  resignation: "Resignation",
  retirement: "Retirement",
  dismissal: "Dismissal",
  retrenchment: "Retrenchment",
  contract_end: "Contract end",
  death: "Death",
  mutual_agreement: "Mutual agreement",
};

export function leaverCategory(reason: string | null): "voluntary" | "involuntary" | "other" {
  if (reason && VOLUNTARY.has(reason)) return "voluntary";
  if (reason && INVOLUNTARY.has(reason)) return "involuntary";
  return "other";
}

const turnoverParams = ({ today }: { today: string }) =>
  z
    .object({ from: isoDate.default(`${today.slice(0, 4)}-01-01`), to: isoDate.default(today) })
    .refine((p) => p.from <= p.to, { message: "Pick a start date on or before the end date.", path: ["from"] });

export const turnoverReport: ReportDefinition<z.output<ReturnType<typeof turnoverParams>>> = {
  id: "people.turnover",
  module: "employees",
  title: "Joiners, leavers and turnover",
  description: "Who joined and left in a period, why they left, and the turnover rate.",
  read: "reports_people:read",
  export: "reports_people:export",
  params: turnoverParams,
  fields: [
    { key: "from", label: "From", kind: "date" },
    { key: "to", label: "To", kind: "date" },
  ],
  columns: () => [
    { key: "date", title: "Date", type: "date" },
    { key: "movement", title: "Movement", type: "text" },
    { key: "employeeNumber", title: "Employee no.", type: "text" },
    { key: "name", title: "Employee", type: "text" },
    { key: "department", title: "Department", type: "text" },
    { key: "reason", title: "Reason for leaving", type: "text" },
    { key: "category", title: "Voluntary?", type: "text" },
  ],
  defaultSort: { key: "date", dir: "asc" },
  async *run(ctx, p) {
    const events = await tenureEventsBetween(ctx.db, ctx.orgId, p.from, p.to, ctx.employeeIds);
    yield* inBatches(
      events.map((e) => ({
        date: e.date,
        movement: e.kind === "joiner" ? "Joined" : "Left",
        kind: e.kind,
        employeeNumber: e.employeeNumber,
        name: e.name,
        department: e.department,
        reason: e.kind === "leaver" ? (REASON_LABEL[e.cessationReason ?? ""] ?? "Not recorded") : null,
        category:
          e.kind === "leaver"
            ? { voluntary: "Voluntary", involuntary: "Involuntary", other: "Other" }[leaverCategory(e.cessationReason)]
            : null,
      })),
    );
  },
  async summary(rows, ctx, p) {
    const start = (await membersOn(ctx.db, ctx.orgId, p.from, ctx.employeeIds)).length;
    const end = (await membersOn(ctx.db, ctx.orgId, p.to, ctx.employeeIds)).length;
    const leavers = rows.filter((r) => r.kind === "leaver");
    const count = (cat: string) => leavers.filter((r) => r.category === cat).length;
    return [
      { label: `Headcount on ${displayDate(p.from)}`, value: start, type: "integer" },
      { label: `Headcount on ${displayDate(p.to)}`, value: end, type: "integer" },
      { label: "Joiners", value: rows.filter((r) => r.kind === "joiner").length, type: "integer" },
      { label: "Leavers", value: leavers.length, type: "integer" },
      { label: "Voluntary (resignation, retirement)", value: count("Voluntary"), type: "integer" },
      { label: "Involuntary (dismissal, retrenchment, contract end)", value: count("Involuntary"), type: "integer" },
      { label: "Other (death, mutual agreement, not recorded)", value: count("Other"), type: "integer" },
      {
        label: "Turnover rate",
        value: turnoverTenths(leavers.length, start, end),
        type: "percent",
        hint: "Leavers ÷ average of the headcount at the start and the end × 100.",
      },
    ];
  },
  emptyMessage: (p) =>
    `Nobody joined or left between ${displayDate(p.from)} and ${displayDate(p.to)}. Widen the dates.`,
  notes: ["A rehire counts as a joiner on the rehire date. Departments are as on the day of the movement."],
};

const STATE_LABEL = { valid: "Valid", expiring: "Expiring", expired: "Expired", cancelled: "Cancelled" } as const;

const expiryParams = ({ today }: { today: string }) => z.object({ until: isoDate.default(addDays(today, 90)) });

export const workPassExpiryReport: ReportDefinition<z.output<ReturnType<typeof expiryParams>>> = {
  id: "people.work_pass_expiry",
  module: "employees",
  title: "Work pass expiry",
  description: "Current employees' work passes that have expired or expire by a date, soonest first.",
  read: "work_pass:read",
  export: "work_pass:read",
  scopes: ["all"],
  params: expiryParams,
  fields: [{ key: "until", label: "Expiring on or before", kind: "date" }],
  columns: () => [
    { key: "expiresOn", title: "Expires", type: "date" },
    { key: "daysLeft", title: "Days left", type: "integer" },
    { key: "state", title: "Status", type: "text" },
    { key: "employeeNumber", title: "Employee no.", type: "text" },
    { key: "name", title: "Employee", type: "text" },
    { key: "passType", title: "Pass", type: "text" },
    { key: "passNumber", title: "Pass number", type: "text", sensitivity: "nric" },
  ],
  defaultSort: { key: "expiresOn", dir: "asc" },
  async *run(ctx, p) {
    const rows = await passesExpiring(ctx.db, ctx.orgId, ctx.today, p.until, ctx.employeeIds);
    yield* inBatches(
      rows.map((r) => ({
        expiresOn: r.expiresOn,
        daysLeft: daysBetween(ctx.today, r.expiresOn),
        state: STATE_LABEL[passState({ expiresOn: r.expiresOn, cancelledOn: null }, ctx.today)],
        employeeNumber: r.employeeNumber,
        name: r.name,
        passType: WORK_PASS_TYPES.find((t) => t.code === r.passType)?.label ?? r.passType,
        passNumber: r.passNumberMasked,
      })),
    );
  },
  emptyMessage: (p) => `No work passes expire on or before ${displayDate(p.until)}. Pick a later date.`,
  notes: ["Only each employee's latest pass is listed: a renewal replaces the old pass."],
};

export const peopleReportSource: ReportSource = {
  module: "employees",
  reports: [headcountReport, headcountTrendReport, turnoverReport, workPassExpiryReport],
};
