import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { payrollPayslips, payrollRuns } from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import { inBatches, type ReportDefinition, type ReportRow, type ReportSource } from "../reporting/types.ts";
import { dateLabel } from "./engine/dates.ts";

/**
 * Payroll cost by month and department (add-reporting design decision 5, spec "Module reports
 * through definitions"): finalised runs only (approved or paid). Owners and payroll_admins only
 * (`reports_payroll_cost:*`); every money column is salary-class as well.
 *
 * How the figures reconcile with payroll, to the cent:
 * - gross, employer CPF, FWL, employee CPF and SHG are summed over the payslips of the month's
 *   effective runs (approved or paid and not replaced by an adjustment run);
 * - SDL is the employer's monthly total, rounded once by payroll: the sum of `sdlChargedCents` over
 *   every finalised run of the month (an adjustment run charges only the difference). It is split
 *   across departments in proportion to each employee's SDL-liable wages for the month, with the
 *   cents left over by rounding going to the largest remainders, so departments add up exactly;
 * - employer total = gross + employer CPF (+ any employee share the employer bore) + SDL + FWL.
 * The department is the one on the employee's payroll snapshot (employment as at the period end).
 */

export interface CostCell {
  month: string;
  department: string;
  headcount: number;
  grossCents: number;
  employerCpfCents: number;
  absorbedCpfCents: number;
  sdlCents: number;
  fwlCents: number;
  employeeCpfCents: number;
  shgCents: number;
  employerTotalCents: number;
}

/** Splits `total` over `weights` (integers) so the parts sum to `total` exactly (largest remainder). */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) {
    const out = weights.map(() => 0);
    if (total !== 0 && out.length) out[0] = total;
    return out;
  }
  const big = BigInt(total);
  const s = BigInt(sum);
  const parts = weights.map((w) => (big * BigInt(w)) / s);
  const rest = weights.map((w, i) => ({ i, r: (big * BigInt(w)) % s }));
  let left = total - parts.reduce((a, b) => a + Number(b), 0);
  rest.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const out = parts.map(Number);
  for (const { i } of rest) {
    if (left <= 0) break;
    out[i] = (out[i] as number) + 1;
    left--;
  }
  return out;
}

/** Payroll cost cells per month × department for finalised runs in [from, to] (YYYY-MM). */
export async function payrollCost(db: Db, orgId: string, from: string, to: string): Promise<CostCell[]> {
  const runs = await db
    .select({
      id: payrollRuns.id,
      month: payrollRuns.month,
      supersededBy: payrollRuns.supersededByRunId,
      totals: payrollRuns.totals,
    })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, orgId),
        inArray(payrollRuns.status, ["approved", "paid"]),
        gte(payrollRuns.month, from),
        lte(payrollRuns.month, to),
      ),
    );
  if (!runs.length) return [];
  const effective = runs.filter((r) => !r.supersededBy);
  const slips = effective.length
    ? await db
        .select({
          runId: payrollPayslips.runId,
          employeeId: payrollPayslips.employeeId,
          input: payrollPayslips.input,
          result: payrollPayslips.result,
        })
        .from(payrollPayslips)
        .where(
          and(
            eq(payrollPayslips.orgId, orgId),
            inArray(
              payrollPayslips.runId,
              effective.map((r) => r.id),
            ),
          ),
        )
    : [];
  const monthOf = new Map(runs.map((r) => [r.id, r.month]));
  const cells = new Map<string, CostCell & { employees: Set<string>; sdlUnits: Map<string, number> }>();
  for (const s of slips) {
    const month = monthOf.get(s.runId) as string;
    const department = s.input.employment.department ?? "No department";
    const key = `${month}|${department}`;
    const c = cells.get(key) ?? {
      month,
      department,
      headcount: 0,
      grossCents: 0,
      employerCpfCents: 0,
      absorbedCpfCents: 0,
      sdlCents: 0,
      fwlCents: 0,
      employeeCpfCents: 0,
      shgCents: 0,
      employerTotalCents: 0,
      employees: new Set<string>(),
      sdlUnits: new Map<string, number>(),
    };
    const t = s.result.totals;
    c.employees.add(s.employeeId);
    c.grossCents += t.grossCents;
    c.employerCpfCents += t.cpfEmployerCents;
    c.absorbedCpfCents += t.cpfEmployeeShareAbsorbedCents ?? 0;
    c.fwlCents += t.fwlCents;
    c.employeeCpfCents += t.cpfEmployeeCents;
    c.shgCents += t.shgCents;
    // Month-cumulative SDL units: keep the latest (largest) per employee.
    c.sdlUnits.set(s.employeeId, Math.max(c.sdlUnits.get(s.employeeId) ?? 0, s.result.month.sdlUnits1e4Cent));
    cells.set(key, c);
  }
  // SDL per month, split by SDL-liable wages.
  const months = [...new Set(runs.map((r) => r.month))].sort();
  for (const m of months) {
    const sdlMonth = runs.filter((r) => r.month === m).reduce((a, r) => a + (r.totals?.sdlChargedCents ?? 0), 0);
    const inMonth = [...cells.values()]
      .filter((c) => c.month === m)
      .sort((a, b) => a.department.localeCompare(b.department));
    // An employee in two departments in one month (off-cycle run after a transfer): count units once, in the latest.
    const parts = allocate(
      sdlMonth,
      inMonth.map((c) => [...c.sdlUnits.values()].reduce((a, b) => a + b, 0)),
    );
    inMonth.forEach((c, i) => {
      c.sdlCents = parts[i] as number;
    });
  }
  return [...cells.values()].map(({ employees, sdlUnits: _u, ...c }) => ({
    ...c,
    headcount: employees.size,
    employerTotalCents: c.grossCents + c.employerCpfCents + c.absorbedCpfCents + c.sdlCents + c.fwlCents,
  }));
}

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the month format YYYY-MM, like 2026-10.");

const params = ({ today }: { today: string }) =>
  z
    .object({
      from: month.default(`${today.slice(0, 4)}-01`),
      to: month.default(today.slice(0, 7)),
      by: z.enum(["department", "month"]).default("department"),
    })
    .refine((p) => p.from <= p.to, { message: "Pick a start month on or before the end month.", path: ["from"] });

/** `Nov 2026`. */
function monthLabel(m: string): string {
  return `${dateLabel(`${m}-01`).slice(2)}`;
}

function monthsIn(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > to) break;
    out.push(key);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

const money = (key: keyof CostCell, title: string) =>
  ({ key, title, type: "money_cents", total: "sum", sensitivity: "salary" }) as const;

export const payrollCostReport: ReportDefinition<z.output<ReturnType<typeof params>>> = {
  id: "payroll.cost",
  module: "payroll",
  title: "Payroll cost",
  description:
    "Gross pay, employer CPF, SDL, FWL and total employer cost by month and department, from finalised runs.",
  read: "reports_payroll_cost:read",
  export: "reports_payroll_cost:export",
  scopes: ["all"],
  params,
  fields: [
    { key: "from", label: "From month", kind: "month" },
    { key: "to", label: "To month", kind: "month" },
    {
      key: "by",
      label: "Rows",
      kind: "select",
      options: [
        { value: "department", label: "Month and department" },
        { value: "month", label: "Month" },
      ],
    },
  ],
  columns: (p) => [
    { key: "month", title: "Month", type: "text" },
    ...(p.by === "department" ? [{ key: "department", title: "Department", type: "text" as const }] : []),
    { key: "headcount", title: "Paid", type: "integer" },
    money("grossCents", "Gross pay (S$)"),
    money("employerCpfCents", "Employer CPF (S$)"),
    money("sdlCents", "SDL (S$)"),
    money("fwlCents", "FWL estimate (S$)"),
    money("employerTotalCents", "Employer total (S$)"),
    money("employeeCpfCents", "Employee CPF, deducted (S$)"),
    money("shgCents", "SHG, deducted (S$)"),
  ],
  defaultSort: { key: "month", dir: "asc" },
  async *run(ctx, p) {
    if (ctx.employeeIds) return; // organisation scope only
    const cells = await payrollCost(ctx.db, ctx.orgId, p.from, p.to);
    let rows: ReportRow[];
    if (p.by === "department") {
      rows = cells.map((c) => ({ ...c, month: c.month }));
    } else {
      const byMonth = new Map<string, ReportRow>();
      for (const c of cells) {
        const r = byMonth.get(c.month) ?? { month: c.month, headcount: 0 };
        for (const k of [
          "headcount",
          "grossCents",
          "employerCpfCents",
          "sdlCents",
          "fwlCents",
          "employerTotalCents",
          "employeeCpfCents",
          "shgCents",
        ] as const)
          r[k] = Number(r[k] ?? 0) + c[k];
        byMonth.set(c.month, r);
      }
      rows = [...byMonth.values()];
    }
    yield* inBatches(rows);
  },
  async summary(rows, ctx, p) {
    // Name the months whose payroll exists but isn't finalised; count the months with none at all.
    const paid = new Set(rows.map((r) => String(r.month)));
    const open = await ctx.db
      .selectDistinct({ month: payrollRuns.month })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.orgId, ctx.orgId),
          inArray(payrollRuns.status, ["draft", "in_review"]),
          gte(payrollRuns.month, p.from),
          lte(payrollRuns.month, p.to),
        ),
      );
    const notFinal = open
      .map((r) => r.month)
      .filter((m) => !paid.has(m))
      .sort();
    const none = monthsIn(p.from, p.to).filter((m) => !paid.has(m) && !notFinal.includes(m));
    return [
      ...(notFinal.length
        ? [
            {
              label: "No finalised payroll",
              value: notFinal.map(monthLabel).join(", "),
              type: "text" as const,
              hint: "Draft and in-review runs are not counted until they are approved.",
            },
          ]
        : []),
      ...(none.length ? [{ label: "Months with no payroll run", value: none.length, type: "integer" as const }] : []),
    ];
  },
  emptyMessage: (p) =>
    p.from === p.to
      ? `No finalised payroll for ${monthLabel(p.from)}. Approve the run, or pick another month.`
      : `No finalised payroll between ${monthLabel(p.from)} and ${monthLabel(p.to)}. Widen the months.`,
  notes: [
    "Only approved or paid runs count; a run replaced by an adjustment counts once, as the adjustment.",
    "SDL is the month's total from payroll, split across departments by SDL-liable wages so the rows add up exactly.",
    "FWL is an estimate from the levy settings (payroll never deducts it). Employer total = gross + employer CPF + SDL + FWL.",
    "Departments are from each payslip's employment as at the period end.",
  ],
  chart: { label: "month", value: "employerTotalCents" },
};

export const payrollReportSource: ReportSource = { module: "payroll", reports: [payrollCostReport] };
