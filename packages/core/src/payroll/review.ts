import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  type PayrollPayslip,
  type PayrollRun,
  payrollPayslips,
  payrollRunItems,
  payrollRuns,
} from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";
import { dateLabel, monthLabel, monthShortName, sgd } from "./engine/dates.ts";
import type { PayInput, PayIssue, PayResult } from "./engine/types.ts";
import { loadRun } from "./service.ts";
import { runEmployeeIds } from "./snapshot.ts";

/** One row of the review table. */
export interface ReviewRow {
  payslipId: string;
  employeeId: string;
  employeeNumber: string;
  name: string;
  department: string | null;
  basicCents: number;
  allowancesCents: number;
  overtimeCents: number;
  additionalCents: number;
  nplCents: number;
  grossCents: number;
  cpfEmployeeCents: number;
  shgCents: number;
  otherDeductionsCents: number;
  reimbursementsCents: number;
  netCents: number;
  netPayableCents: number;
  cpfEmployerCents: number;
  blocking: number;
  warnings: number;
  flags: string[];
}

export interface RunChange {
  kind: "joined" | "left" | "basic_changed" | "new_item" | "net_changed" | "not_in_run" | "residency";
  employeeId: string;
  name: string;
  text: string;
}

export interface RunIssueRow extends PayIssue {
  employeeId: string | null;
  employeeName: string | null;
}

export interface RunOverview {
  run: PayrollRun;
  rows: ReviewRow[];
  issues: RunIssueRow[];
  changes: { comparedWith: { runId: string; month: string } | null; headline: string; items: RunChange[] };
  adjustment: { ofRunId: string; ofMonth: string } | null;
  supersededBy: string | null;
}

function flagsFor(input: PayInput, r: PayResult): string[] {
  const f: string[] = [];
  if (input.employment.hireDate >= input.run.periodStart && input.employment.hireDate <= input.run.periodEnd)
    f.push("joiner");
  if (input.employment.lastWorkingDay && input.employment.lastWorkingDay <= input.run.periodEnd) f.push("leaver");
  if (r.totals.nplCents > 0) f.push("npl");
  if (r.totals.awCpfCents > 0) f.push("aw");
  if (r.cpf?.awCeiling && r.cpf.awNotSubjectCents > 0) f.push("aw_ceiling");
  if (r.totals.overtimeCents > 0) f.push("ot");
  if (input.employee.residency.status === "FOREIGNER") f.push("foreigner");
  if (
    input.employee.residency.status === "SPR" &&
    r.cpf?.residencyCategory.startsWith("SPR") &&
    !r.cpf.residencyCategory.startsWith("SPR3")
  )
    f.push("spr_graduated");
  return f;
}

export function toRow(s: PayrollPayslip): ReviewRow {
  const r = s.result;
  return {
    payslipId: s.id,
    employeeId: s.employeeId,
    employeeNumber: s.employeeNumber,
    name: s.employeeName,
    department: s.input.employment.department,
    basicCents: r.totals.basicCents,
    allowancesCents: r.totals.allowancesCents,
    overtimeCents: r.totals.overtimeCents,
    additionalCents: r.totals.additionalCents,
    nplCents: r.totals.nplCents,
    grossCents: r.totals.grossCents,
    cpfEmployeeCents: r.totals.cpfEmployeeCents,
    shgCents: r.totals.shgCents,
    otherDeductionsCents: r.totals.otherDeductionsCents,
    reimbursementsCents: r.totals.reimbursementsCents,
    netCents: r.totals.netCents,
    netPayableCents: r.totals.netPayableCents,
    cpfEmployerCents: r.totals.cpfEmployerCents,
    blocking: s.blockingCount,
    warnings: s.warningCount,
    flags: flagsFor(s.input, r),
  };
}

const basicRate = (i: PayInput) => i.compensation[i.compensation.length - 1]?.amountCents ?? null;

/** Changes since the previous month's effective regular payroll (the "3 changes since September" list). */
export function diffRuns(current: PayrollPayslip[], previous: PayrollPayslip[], run: PayrollRun): RunChange[] {
  const prev = new Map(previous.map((p) => [p.employeeId, p]));
  const cur = new Map(current.map((p) => [p.employeeId, p]));
  const out: RunChange[] = [];
  for (const s of [...current].sort((a, b) => a.employeeName.localeCompare(b.employeeName))) {
    const p = prev.get(s.employeeId);
    const i = s.input;
    if (
      i.employment.lastWorkingDay &&
      i.employment.lastWorkingDay >= run.periodStart &&
      i.employment.lastWorkingDay <= run.periodEnd
    ) {
      out.push({
        kind: "left",
        employeeId: s.employeeId,
        name: s.employeeName,
        text: `Leaves on ${dateLabel(i.employment.lastWorkingDay)}: pay pro-rated to the last day.`,
      });
    }
    if (!p) {
      const joined = i.employment.hireDate >= run.periodStart;
      out.push({
        kind: "joined",
        employeeId: s.employeeId,
        name: s.employeeName,
        text: joined
          ? `Joined on ${dateLabel(i.employment.hireDate)}${s.result.lines.find((l) => l.category === "basic")?.detail ? `, pay pro-rated (${s.result.lines.find((l) => l.category === "basic")?.detail})` : ""}.`
          : "New to payroll this month.",
      });
    }
    const before = p ? basicRate(p.input) : null;
    const after = basicRate(i);
    if (before !== null && after !== null && before !== after) {
      out.push({
        kind: "basic_changed",
        employeeId: s.employeeId,
        name: s.employeeName,
        text: `Basic pay ${sgd(before)} → ${sgd(after)}.`,
      });
    }
    for (const item of i.items.filter(
      (x) =>
        ["bonus", "commission", "backpay", "other_earning", "deduction", "unpaid_leave", "overtime"].includes(x.kind) &&
        !x.id.startsWith("encashment:"),
    )) {
      const label =
        item.kind === "unpaid_leave"
          ? `No-pay leave, ${item.days} ${item.days === 1 ? "day" : "days"}`
          : item.kind === "overtime"
            ? `Overtime, ${(item.minutes ?? 0) / 60} h`
            : `${item.label} ${item.amountCents !== null ? sgd(item.amountCents) : ""}`.trim();
      out.push({ kind: "new_item", employeeId: s.employeeId, name: s.employeeName, text: `${label}.` });
    }
    if (p && p.input.employee.residency.status !== i.employee.residency.status) {
      out.push({
        kind: "residency",
        employeeId: s.employeeId,
        name: s.employeeName,
        text: `Residency changed for CPF (${p.input.employee.residency.status} → ${i.employee.residency.status}).`,
      });
    }
  }
  for (const p of previous) {
    if (
      !cur.has(p.employeeId) &&
      !(p.input.employment.lastWorkingDay && p.input.employment.lastWorkingDay <= p.input.run.periodEnd)
    ) {
      out.push({
        kind: "not_in_run",
        employeeId: p.employeeId,
        name: p.employeeName,
        text: `Paid in ${monthShortName(p.input.run.month)} but not in this run.`,
      });
    }
  }
  return out;
}

async function previousRegular(db: Db, run: PayrollRun): Promise<PayrollRun | null> {
  const rows = await db
    .select()
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, run.orgId),
        lt(payrollRuns.month, run.month),
        inArray(payrollRuns.status, ["approved", "paid"]),
      ),
    )
    .orderBy(desc(payrollRuns.month), desc(payrollRuns.decidedAt));
  const month = rows.find((r) => r.kind !== "off_cycle")?.month;
  if (!month) return null;
  // The effective regular (or its latest approved adjustment) for that month.
  return rows.find((r) => r.month === month && r.kind !== "off_cycle" && !r.supersededByRunId) ?? null;
}

/** More employees than this with the same warning are listed as one line. */
const GROUP_AT = 4;

export async function runOverview(db: Db, orgId: string, runId: string): Promise<RunOverview> {
  const run = await loadRun(db, orgId, runId);
  const slips = await db
    .select()
    .from(payrollPayslips)
    .where(and(eq(payrollPayslips.orgId, orgId), eq(payrollPayslips.runId, run.id)));
  slips.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.employeeId.localeCompare(b.employeeId));
  const issues: RunIssueRow[] = (run.issues ?? []).map((i) => ({ ...i, employeeId: null, employeeName: null }));
  const perEmployee: RunIssueRow[] = [];
  for (const s of slips) {
    for (const i of s.result.issues) {
      if (i.severity === "info") continue;
      perEmployee.push({ ...i, employeeId: s.employeeId, employeeName: s.employeeName });
    }
  }
  // The same warning for many people reads as one line ("22 employees: …"); blocking issues stay
  // per employee so each can be fixed. The drawer still lists each employee's own issues.
  const byCode = new Map<string, RunIssueRow[]>();
  for (const i of perEmployee) if (i.severity === "warning") byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
  for (const i of perEmployee) {
    const same = byCode.get(i.code);
    if (i.severity !== "warning" || !same || same.length <= GROUP_AT) {
      issues.push(i);
    } else if (same[0] === i) {
      issues.push({
        ...i,
        employeeId: null,
        employeeName: `${same.length} employees`,
        message: `${same
          .slice(0, 3)
          .map((x) => x.employeeName)
          .join(", ")} and ${same.length - 3} more. For example: ${i.message}`,
      });
    }
  }
  const order = { blocking: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  let comparedWith: RunOverview["changes"]["comparedWith"] = null;
  let items: RunChange[] = [];
  if (run.kind === "regular" || run.kind === "adjustment") {
    const prev =
      run.kind === "adjustment" && run.adjustsRunId
        ? await loadRun(db, orgId, run.adjustsRunId)
        : await previousRegular(db, run);
    if (prev) {
      comparedWith = { runId: prev.id, month: prev.month };
      const prevSlips = await db
        .select()
        .from(payrollPayslips)
        .where(and(eq(payrollPayslips.orgId, orgId), eq(payrollPayslips.runId, prev.id)));
      items = run.kind === "adjustment" ? diffAdjustment(slips, prevSlips) : diffRuns(slips, prevSlips, run);
    }
  }
  for (const slip of slips)
    for (const item of slip.input.items.filter((i) => i.id.startsWith("encashment:"))) {
      items.push({
        kind: "new_item",
        employeeId: slip.employeeId,
        name: slip.employeeName,
        text: `${item.label}: ${sgd(item.amountCents ?? 0)} (AW), approved leave payout.`,
      });
    }
  const against = comparedWith
    ? run.kind === "adjustment"
      ? "the original run"
      : monthShortName(comparedWith.month)
    : null;
  const headline = !comparedWith
    ? run.computedAt
      ? items.length
        ? `${items.length} approved ${items.length === 1 ? "encashment" : "encashments"} in this run.`
        : "First payroll run: nothing to compare with."
      : "Compute the run to see changes."
    : items.length === 0
      ? `No changes since ${against}.`
      : `${items.length} ${items.length === 1 ? "change" : "changes"} since ${against}`;
  let adjustment: RunOverview["adjustment"] = null;
  if (run.adjustsRunId) {
    const of = await loadRun(db, orgId, run.adjustsRunId);
    adjustment = { ofRunId: of.id, ofMonth: of.month };
  }
  return {
    run,
    rows: slips.map(toRow),
    issues,
    changes: { comparedWith, headline, items },
    adjustment,
    supersededBy: run.supersededByRunId,
  };
}

function diffAdjustment(current: PayrollPayslip[], original: PayrollPayslip[]): RunChange[] {
  const orig = new Map(original.map((o) => [o.employeeId, o]));
  const out: RunChange[] = [];
  for (const s of current) {
    const o = orig.get(s.employeeId);
    if (!o) continue;
    if (o.netCents !== s.netCents) {
      out.push({
        kind: "net_changed",
        employeeId: s.employeeId,
        name: s.employeeName,
        text: `Net pay ${sgd(o.netCents)} → ${sgd(s.netCents)} (${s.netPayableCents >= 0 ? "pay" : "overpaid"} ${sgd(Math.abs(s.netPayableCents))}).`,
      });
    }
  }
  return out;
}

export async function employeeDetail(db: Db, orgId: string, runId: string, employeeId: string) {
  const run = await loadRun(db, orgId, runId);
  const [slip] = await db
    .select()
    .from(payrollPayslips)
    .where(
      and(
        eq(payrollPayslips.orgId, orgId),
        eq(payrollPayslips.runId, run.id),
        eq(payrollPayslips.employeeId, employeeId),
      ),
    );
  const items = await db
    .select()
    .from(payrollRunItems)
    .where(
      and(
        eq(payrollRunItems.orgId, orgId),
        eq(payrollRunItems.runId, run.id),
        eq(payrollRunItems.employeeId, employeeId),
      ),
    );
  if (!slip && !(await runEmployeeIds(db, run)).includes(employeeId)) {
    throw new AppError("not_found", "That employee isn't in this payroll run.");
  }
  return {
    run,
    slip: slip ?? null,
    items: items.sort((a, b) => (a.id < b.id ? -1 : 1)),
    monthText: monthLabel(run.month),
  };
}
