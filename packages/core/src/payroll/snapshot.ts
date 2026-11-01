import type { CpfAwPayment, CpfResidency, CpfYearToDate, WorkPattern } from "@crowhr/sg-rules";
import { and, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import {
  allowanceTypes,
  compensationRecords,
  employees,
  employmentRecords,
  recurringAllowances,
  tenures,
  workPasses,
  ytdOpeningBalances,
} from "../db/schema/employees.ts";
import type { WorkWeek } from "../db/schema/organisation.ts";
import { companyProfiles, departments, workSchedules, workScheduleVersions } from "../db/schema/organisation.ts";
import {
  type PayrollRun,
  payrollAllowanceSettings,
  payrollBackpayNotices,
  payrollPayslips,
  payrollRunItems,
  payrollRuns,
  payrollSettings,
} from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import { findAsAt } from "../employees/effective.ts";
import { addMonths as addMonthsTo, maxDate, minDate, monthLabel } from "./engine/dates.ts";
import {
  ENGINE_VERSION,
  type MonthBefore,
  type MonthCharged,
  type PayInput,
  type PayIssue,
  type PayResult,
  type RunItemInput,
} from "./engine/types.ts";
import type { ApprovedOvertime, PayableClaim, RosterDaysWorked, RosterScheduledDays, UnpaidLeaveDay } from "./ports.ts";

/**
 * Gathers each employee's input snapshot for a run from the live records (people module tables,
 * run items, earlier payslips). Everything the engine reads comes through here, so the stored
 * snapshot is the complete explanation of a result.
 */

const EFFECTIVE_STATUSES = ["approved", "paid"] as const;

const ZERO: MonthCharged = {
  cpfTotalCents: 0,
  cpfEmployeeCents: 0,
  cpfAwTopUpEmployeeCents: 0,
  cpfEmployerCents: 0,
  shgCents: {},
  sdlUnits1e4Cent: 0,
};

function addCharged(a: MonthCharged, b: MonthCharged): MonthCharged {
  const shg: Record<string, number> = { ...a.shgCents } as Record<string, number>;
  for (const [f, v] of Object.entries(b.shgCents)) shg[f] = (shg[f] ?? 0) + (v ?? 0);
  return {
    cpfTotalCents: a.cpfTotalCents + b.cpfTotalCents,
    cpfEmployeeCents: a.cpfEmployeeCents + b.cpfEmployeeCents,
    cpfAwTopUpEmployeeCents: a.cpfAwTopUpEmployeeCents + (b.cpfAwTopUpEmployeeCents ?? 0),
    cpfEmployerCents: a.cpfEmployerCents + b.cpfEmployerCents,
    shgCents: shg,
    sdlUnits1e4Cent: a.sdlUnits1e4Cent + b.sdlUnits1e4Cent,
  };
}

/** Monday-first schedule week → sg-rules Sunday-first work pattern. */
export function toWorkPattern(days: WorkWeek): WorkPattern {
  const value = (t: string) => (t === "working" ? 1 : t === "half" ? 0.5 : 0);
  const mondayFirst = days.map((d) => value(d.type));
  return [mondayFirst[6] ?? 0, ...mondayFirst.slice(0, 6)] as unknown as WorkPattern;
}

/** The chain of runs an adjustment replaces (its original, that one's original, …). */
export async function replacedChain(db: Db, orgId: string, run: PayrollRun): Promise<string[]> {
  const chain: string[] = [];
  let next = run.adjustsRunId;
  while (next) {
    chain.push(next);
    const [r] = await db
      .select({ adjustsRunId: payrollRuns.adjustsRunId })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.orgId, orgId), eq(payrollRuns.id, next)));
    next = r?.adjustsRunId ?? null;
  }
  return chain;
}

/** Employees a run pays. Regular: everyone employed in the period except those with an off-cycle final pay that month. */
export async function runEmployeeIds(db: Db, run: PayrollRun): Promise<string[]> {
  if (run.employeeIds) return [...run.employeeIds].sort();
  const employed = await db
    .selectDistinct({ id: tenures.employeeId })
    .from(tenures)
    .where(
      and(
        eq(tenures.orgId, run.orgId),
        lte(tenures.hireDate, run.periodEnd),
        or(isNull(tenures.lastWorkingDay), gte(tenures.lastWorkingDay, run.periodStart)),
      ),
    );
  const finalPay = await db
    .select({ employeeIds: payrollRuns.employeeIds })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, run.orgId),
        eq(payrollRuns.month, run.month),
        eq(payrollRuns.offCycleReason, "final_pay"),
      ),
    );
  const excluded = new Set(finalPay.flatMap((r) => r.employeeIds ?? []));
  return employed
    .map((e) => e.id)
    .filter((id) => !excluded.has(id))
    .sort();
}

interface PriorSlip {
  runId: string;
  month: string;
  kind: string;
  status: string;
  decidedAt: Date | null;
  supersededByRunId: string | null;
  result: PayResult;
  netPayableCents: number;
}

async function priorSlips(
  db: Db,
  orgId: string,
  employeeIds: string[],
  year: string,
  month: string,
  exceptRunId: string,
) {
  if (employeeIds.length === 0) return new Map<string, PriorSlip[]>();
  const rows = await db
    .select({
      employeeId: payrollPayslips.employeeId,
      runId: payrollRuns.id,
      month: payrollRuns.month,
      kind: payrollRuns.kind,
      status: payrollRuns.status,
      decidedAt: payrollRuns.decidedAt,
      supersededByRunId: payrollRuns.supersededByRunId,
      result: payrollPayslips.result,
      netPayableCents: payrollPayslips.netPayableCents,
    })
    .from(payrollPayslips)
    .innerJoin(
      payrollRuns,
      and(eq(payrollRuns.orgId, payrollPayslips.orgId), eq(payrollRuns.id, payrollPayslips.runId)),
    )
    .where(
      and(
        eq(payrollPayslips.orgId, orgId),
        inArray(payrollPayslips.employeeId, employeeIds),
        inArray(payrollRuns.status, [...EFFECTIVE_STATUSES]),
        gte(payrollRuns.month, `${year}-01`),
        lte(payrollRuns.month, month),
      ),
    );
  const out = new Map<string, PriorSlip[]>();
  for (const r of rows) {
    if (r.runId === exceptRunId) continue;
    const list = out.get(r.employeeId) ?? [];
    list.push(r);
    out.set(r.employeeId, list);
  }
  return out;
}

function stateFromOpening(
  row: typeof ytdOpeningBalances.$inferSelect,
  year: string,
): { state: CpfYearToDate; issues: PayIssue[]; text: string } {
  const issues: PayIssue[] = [];
  const through = `${year}-${String(row.throughMonth).padStart(2, "0")}`;
  const owSubject = row.owCpfCents ?? Math.min(row.owCents, 800_000 * row.throughMonth);
  if (row.owCpfCents === null) {
    issues.push({
      code: "YTD_OW_CPF_ESTIMATED",
      severity: "warning",
      message: `The year-to-date opening balance has no "OW subject to CPF"; ${monthLabel(through)} OW paid is used, capped at the OW ceiling. Enter the figure from the previous payroll system for an exact AW ceiling.`,
      source: null,
    });
  }
  const awPayments: CpfAwPayment[] = [];
  if (row.awCents > 0) {
    const subject = row.awCpfCents ?? row.awCents;
    awPayments.push({
      payableMonth: through,
      owCents: Math.round(row.owCents / Math.max(1, row.throughMonth)),
      awPayableCents: row.awCents,
      awSubjectCents: Math.min(subject, row.awCents),
    });
    issues.push({
      code: "YTD_AW_SINGLE_PAYMENT",
      severity: "info",
      message: `Opening-balance AW (${row.awCents / 100}) is treated as one AW payment in ${monthLabel(through)} for the AW ceiling, since its monthly breakdown is not known.`,
      source: null,
    });
  }
  return {
    state: { owSubjectCents: owSubject, awPayments },
    issues,
    text: `opening balance from the previous payroll system (January–${monthLabel(through)})`,
  };
}

export interface SnapshotContext {
  run: PayrollRun;
  claims: PayableClaim[];
  /** Approved overtime from attendance (OvertimeSource); entered as items with source "attendance". */
  overtime?: ApprovedOvertime[];
  /** Approved unpaid leave from the leave module, by date (`unpaid_leave` items); a manual item on the same date wins. */
  unpaidLeave?: UnpaidLeaveDay[];
  /** Days worked by rostered staff from attendance (`days_worked` items); a manual `days_worked` item wins. */
  daysWorked?: RosterDaysWorked[];
  /** Scheduled days from published rosters (`scheduled_days` items); a manual `scheduled_days` item wins. */
  scheduledDays?: RosterScheduledDays[];
}

/** Snapshots for every employee of the run, sorted by employee id. */
export async function buildSnapshots(db: Db, ctx: SnapshotContext): Promise<PayInput[]> {
  const { run } = ctx;
  const orgId = run.orgId;
  const ids = await runEmployeeIds(db, run);
  if (ids.length === 0) return [];
  const year = run.month.slice(0, 4);
  const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.orgId, orgId));
  const [settings] = await db.select().from(payrollSettings).where(eq(payrollSettings.orgId, orgId));
  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.orgId, orgId), inArray(employees.id, ids)));
  const tens = await db
    .select()
    .from(tenures)
    .where(and(eq(tenures.orgId, orgId), inArray(tenures.employeeId, ids)));
  const jobs = await db
    .select()
    .from(employmentRecords)
    .where(and(eq(employmentRecords.orgId, orgId), inArray(employmentRecords.employeeId, ids)));
  const comps = await db
    .select()
    .from(compensationRecords)
    .where(and(eq(compensationRecords.orgId, orgId), inArray(compensationRecords.employeeId, ids)));
  const allowances = await db
    .select({ a: recurringAllowances, type: allowanceTypes, setting: payrollAllowanceSettings })
    .from(recurringAllowances)
    .innerJoin(
      allowanceTypes,
      and(
        eq(allowanceTypes.orgId, recurringAllowances.orgId),
        eq(allowanceTypes.id, recurringAllowances.allowanceTypeId),
      ),
    )
    .leftJoin(
      payrollAllowanceSettings,
      and(
        eq(payrollAllowanceSettings.orgId, recurringAllowances.orgId),
        eq(payrollAllowanceSettings.allowanceTypeId, recurringAllowances.allowanceTypeId),
      ),
    )
    .where(and(eq(recurringAllowances.orgId, orgId), inArray(recurringAllowances.employeeId, ids)));
  const passes = await db
    .select()
    .from(workPasses)
    .where(and(eq(workPasses.orgId, orgId), inArray(workPasses.employeeId, ids)));
  const items = await db
    .select()
    .from(payrollRunItems)
    .where(and(eq(payrollRunItems.orgId, orgId), eq(payrollRunItems.runId, run.id)));
  const backpay = await db
    .select()
    .from(payrollBackpayNotices)
    .where(
      and(
        eq(payrollBackpayNotices.orgId, orgId),
        inArray(payrollBackpayNotices.employeeId, ids),
        isNull(payrollBackpayNotices.resolvedRunId),
      ),
    );
  const topUps = await db
    .select({ employeeId: payrollPayslips.employeeId, month: payrollRuns.month, result: payrollPayslips.result })
    .from(payrollPayslips)
    .innerJoin(
      payrollRuns,
      and(eq(payrollRuns.orgId, payrollPayslips.orgId), eq(payrollRuns.id, payrollPayslips.runId)),
    )
    .where(
      and(
        eq(payrollPayslips.orgId, orgId),
        inArray(payrollPayslips.employeeId, ids),
        inArray(payrollRuns.status, ["approved", "paid"]),
        isNull(payrollRuns.supersededByRunId),
        gte(payrollRuns.month, `${Number(year) - 1}-01`),
        ne(payrollRuns.id, run.id),
      ),
    );
  const openings = await db
    .select()
    .from(ytdOpeningBalances)
    .where(
      and(
        eq(ytdOpeningBalances.orgId, orgId),
        eq(ytdOpeningBalances.year, Number(year)),
        inArray(ytdOpeningBalances.employeeId, ids),
      ),
    );
  const depts = await db.select().from(departments).where(eq(departments.orgId, orgId));
  const schedVersions = await db
    .select({ v: workScheduleVersions, kind: workSchedules.kind })
    .from(workScheduleVersions)
    .innerJoin(
      workSchedules,
      and(eq(workSchedules.orgId, workScheduleVersions.orgId), eq(workSchedules.id, workScheduleVersions.scheduleId)),
    )
    .where(eq(workScheduleVersions.orgId, orgId));
  const slips = await priorSlips(db, orgId, ids, year, run.month, run.id);
  const chain = new Set(await replacedChain(db, orgId, run));

  const out: PayInput[] = [];
  for (const id of ids) {
    const e = emps.find((x) => x.id === id);
    if (!e) continue;
    const snapshotIssues: PayIssue[] = [];
    for (const n of backpay
      .filter((b) => b.employeeId === id && b.effectiveFrom < run.periodStart)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))) {
      snapshotIssues.push({
        code: "BACKPAY_OWED",
        severity: "warning",
        message: `Basic pay was changed retroactively from ${n.effectiveFrom}${
          n.previousAmountCents !== null
            ? ` (${(n.previousAmountCents / 100).toFixed(2)} → ${(n.newAmountCents / 100).toFixed(2)} a month)`
            : ""
        }. Add a "Back pay" item for the months already paid: a retrospective increment decided later is AW of the month paid; one paid late by error is OW of the original months (recompute those months).`,
        source:
          "https://www.cpf.gov.sg/service/article/are-retrospective-salary-increments-classified-as-ordinary-wages-ow-or-additional-wages-aw",
      });
    }
    const tenure = tens
      .filter((t) => t.employeeId === id && t.hireDate <= run.periodEnd)
      .sort((a, b) => (a.hireDate < b.hireDate ? 1 : -1))[0];
    if (!tenure) continue;
    const windowEnd = tenure.lastWorkingDay
      ? minDate(run.periodEnd, maxDate(tenure.lastWorkingDay, run.periodStart))
      : run.periodEnd;
    const job =
      findAsAt(
        jobs.filter((j) => j.employeeId === id),
        windowEnd,
      ) ?? jobs.filter((j) => j.employeeId === id).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    const sched = job
      ? findAsAt(
          schedVersions.filter((s) => s.v.scheduleId === job.workScheduleId).map((s) => ({ ...s.v, kind: s.kind })),
          windowEnd,
        )
      : undefined;
    let residency: CpfResidency;
    if (e.residencyStatus === "citizen") residency = { status: "SC" };
    else if (e.residencyStatus === "pr") {
      if (!e.prStartDate) {
        snapshotIssues.push({
          code: "PR_START_DATE_MISSING",
          severity: "blocking",
          message: `${e.legalName} is a PR with no PR start date, so the CPF SPR year cannot be worked out. Add the PR start date on the employee's Personal tab.`,
          source: null,
        });
        residency = { status: "SPR", sprDate: "2000-01-01" };
      } else {
        const option = (e.sprCpfOption ?? "gg").toUpperCase() as "GG" | "FG" | "FF";
        residency = {
          status: "SPR",
          sprDate: e.prStartDate,
          option,
          ...(option !== "GG" && e.sprCpfOptionApprovedOn
            ? { optionFromMonth: e.sprCpfOptionApprovedOn.slice(0, 7) }
            : {}),
        };
      }
    } else residency = { status: "FOREIGNER" };
    const pass = passes
      .filter(
        (p) =>
          p.employeeId === id && p.expiresOn >= run.periodStart && (p.issuedOn === null || p.issuedOn <= run.periodEnd),
      )
      .sort((a, b) => ((a.issuedOn ?? "") < (b.issuedOn ?? "") ? 1 : -1))[0];
    const itemRows = items
      .filter((i) => i.employeeId === id && !i.overtimeSourceId)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(
        (i): RunItemInput => ({
          id: i.holidayDate ? `holiday:${i.employeeId}:${i.holidayDate}` : i.id,
          kind: i.kind,
          label: i.label,
          amountCents: i.amountCents,
          wageClass: i.wageClass,
          cpfLiable: i.cpfLiable,
          awPayableDate: i.awPayableDate,
          minutes: i.minutes,
          days: i.halfDays === null ? null : i.halfDays / 2,
          date: i.itemDate,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
          deductionCategory: i.deductionCategory,
          source: i.source,
        }),
      );

    // CPF YTD state before this month.
    const mine = slips.get(id) ?? [];
    const earlier = mine
      .filter((s) => s.month < run.month && !s.supersededByRunId)
      .sort((a, b) =>
        a.month === b.month
          ? (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0)
          : a.month < b.month
            ? -1
            : 1,
      );
    let cpfStateBefore: CpfYearToDate = { owSubjectCents: 0, awPayments: [] };
    let cpfStateSource = `none: first payroll month of ${year} with this employer`;
    const last = earlier[earlier.length - 1];
    const opening = openings.find((o) => o.employeeId === id);
    if (last) {
      cpfStateBefore = last.result.stateAfter;
      cpfStateSource = `stored state after the ${monthLabel(last.month)} ${last.kind === "regular" ? "payroll" : `${last.kind.replace("_", "-")} run`} (run ${last.runId.slice(-8)})`;
    } else if (opening && `${year}-${String(opening.throughMonth).padStart(2, "0")}` < run.month) {
      const o = stateFromOpening(opening, year);
      cpfStateBefore = o.state;
      cpfStateSource = o.text;
      snapshotIssues.push(...o.issues);
    }
    // Employed earlier this year but neither Crow HR payroll nor an opening balance covers those months:
    // the AW ceiling would count only part of the year's OW.
    const employedFrom = tenure.hireDate > `${year}-01-01` ? tenure.hireDate.slice(0, 7) : `${year}-01`;
    // An opening balance covers January to its last month; otherwise coverage starts at the first Crow HR run.
    const firstCovered = opening ? `${year}-01` : (earlier[0]?.month ?? run.month);
    if (firstCovered > employedFrom) {
      snapshotIssues.push({
        code: "YTD_BEFORE_CROWHR_MISSING",
        severity: "warning",
        message: `Employed since ${monthLabel(employedFrom)}, but ${monthLabel(employedFrom)} to ${monthLabel(addMonthsTo(firstCovered, -1))} were not paid in Crow HR and have no year-to-date opening balance. The AW ceiling counts only the months Crow HR knows. Import the ${year} opening balances in People → Import.`,
        source: "https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions",
      });
    }

    // Earlier runs of the same month.
    const sameMonth = mine.filter((s) => s.month === run.month);
    let monthBefore: MonthBefore | null = null;
    if (sameMonth.length > 0) {
      let others = ZERO;
      let replaced = ZERO;
      let ow = 0;
      let aw = 0;
      let wages = 0;
      let netPaid = 0;
      for (const s of sameMonth) {
        const inChain = chain.has(s.runId);
        if (inChain) {
          replaced = addCharged(replaced, s.result.charged);
          netPaid += s.netPayableCents;
        } else {
          others = addCharged(others, s.result.charged);
          if (!s.supersededByRunId) {
            ow += s.result.totals.owCpfCents;
            aw += s.result.totals.awCpfCents;
            wages += s.result.totals.totalWagesCents;
          }
        }
      }
      monthBefore = {
        owCpfCents: ow,
        awCpfCents: aw,
        totalWagesCents: wages,
        chargedByOthers: others,
        chargedByReplaced: replaced,
        netPaidByReplacedCents: netPaid,
        runIds: sameMonth.map((s) => s.runId).sort(),
      };
    }

    const race = [e.race, e.raceSecondary].filter((r): r is string => !!r);
    out.push({
      engineVersion: ENGINE_VERSION,
      run: {
        id: run.id,
        kind: run.kind,
        offCycleReason: run.offCycleReason,
        month: run.month,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        payDate: run.payDate,
      },
      employer: { legalName: profile?.legalName ?? null },
      employee: {
        id,
        employeeNumber: e.employeeNumber,
        legalName: e.legalName,
        idMasked: e.idNumberMasked,
        dob: e.dob,
        residency,
        race,
        isMuslim: (e.religion ?? "").toLowerCase() === "islam",
        shgOptedOut: e.shgOptOutOn !== null && e.shgOptOutOn <= run.periodEnd,
        workPass: pass
          ? { type: pass.passType, issuedOn: pass.issuedOn, expiresOn: pass.expiresOn, cancelledOn: pass.cancelledOn }
          : null,
        isWorkman: job?.isWorkman ?? false,
        // Only when set, so snapshots (and their hashes) of everyone else are unchanged.
        ...(job?.isManagerOrExecutive ? { isManagerOrExecutive: true } : {}),
      },
      employment: {
        hireDate: tenure.hireDate,
        lastWorkingDay: tenure.lastWorkingDay,
        cessationReason: tenure.cessationReason,
        pattern: sched && sched.kind === "fixed" && sched.days ? toWorkPattern(sched.days) : null,
        weeklyMinutes: sched?.weeklyMinutes ?? null,
        jobTitle: job?.jobTitle ?? null,
        department: depts.find((d) => d.id === job?.departmentId)?.name ?? null,
      },
      compensation: comps
        .filter(
          (c) =>
            c.employeeId === id &&
            c.effectiveFrom <= run.periodEnd &&
            (c.effectiveTo === null || c.effectiveTo > run.periodStart),
        )
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
        .map((c) => ({ from: c.effectiveFrom, to: c.effectiveTo, payBasis: c.payBasis, amountCents: c.amountCents })),
      allowances: allowances
        .filter(
          ({ a }) =>
            a.employeeId === id &&
            a.effectiveFrom <= run.periodEnd &&
            (a.effectiveTo === null || a.effectiveTo > run.periodStart),
        )
        .sort((x, y) => (x.a.id < y.a.id ? -1 : 1))
        .map(({ a, type, setting }) => ({
          id: a.id,
          code: type.code,
          name: type.name,
          amountCents: a.amountCents,
          from: a.effectiveFrom,
          to: a.effectiveTo,
          cpfLiable: setting?.cpfLiable ?? true,
          prorate: setting?.prorate ?? true,
          grossRateIncluded: setting?.grossRateIncluded ?? null,
        })),
      items: [
        ...itemRows,
        ...(ctx.unpaidLeave ?? [])
          .filter((u) => u.employeeId === id && !itemRows.some((i) => i.kind === "unpaid_leave" && i.date === u.date))
          .sort((a, b) => (a.date === b.date ? (a.sourceId < b.sourceId ? -1 : 1) : a.date < b.date ? -1 : 1))
          .map(
            (u): RunItemInput => ({
              id: `leave:${u.sourceId}`,
              kind: "unpaid_leave",
              label: `${u.leaveTypeName} (approved in Leave)`,
              amountCents: null,
              wageClass: null,
              cpfLiable: true,
              awPayableDate: null,
              minutes: null,
              days: u.days,
              date: u.date,
              periodStart: null,
              periodEnd: null,
              deductionCategory: null,
              source: "attendance",
            }),
          ),
        ...(ctx.daysWorked ?? [])
          .filter((d) => d.employeeId === id && !itemRows.some((i) => i.kind === "days_worked"))
          .map(
            (d): RunItemInput => ({
              id: `attendance:${d.sourceId}`,
              kind: "days_worked",
              label: "Days worked (from attendance)",
              amountCents: null,
              wageClass: null,
              cpfLiable: true,
              awPayableDate: null,
              minutes: null,
              days: d.daysWorked,
              date: null,
              periodStart: d.periodStart,
              periodEnd: d.periodEnd,
              deductionCategory: null,
              source: "attendance",
            }),
          ),
        ...(ctx.scheduledDays ?? [])
          .filter((d) => d.employeeId === id && !itemRows.some((i) => i.kind === "scheduled_days"))
          .map(
            (d): RunItemInput => ({
              id: `scheduling:${d.sourceId}`,
              kind: "scheduled_days",
              label: "Scheduled days (from published roster)",
              amountCents: null,
              wageClass: null,
              cpfLiable: true,
              awPayableDate: null,
              minutes: null,
              days: d.scheduledDays,
              date: null,
              periodStart: d.periodStart,
              periodEnd: d.periodEnd,
              deductionCategory: null,
              source: "attendance",
            }),
          ),
        ...(ctx.overtime ?? [])
          .filter((o) => o.employeeId === id)
          .sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1))
          .map(
            (o): RunItemInput => ({
              id: `attendance:${o.sourceId}`,
              kind: "overtime",
              label: "Overtime (approved in attendance)",
              amountCents:
                items.find((i) => i.employeeId === id && i.overtimeSourceId === o.sourceId)?.amountCents ??
                o.amountCents ??
                null,
              wageClass: null,
              cpfLiable: true,
              awPayableDate: null,
              minutes: o.minutes,
              days: null,
              date: null,
              periodStart: o.periodStart,
              periodEnd: o.periodEnd,
              deductionCategory: null,
              source: "attendance",
            }),
          ),
      ],
      reimbursements: ctx.claims
        .filter((c) => c.employeeId === id)
        .sort((a, b) => (a.claimId < b.claimId ? -1 : 1))
        .map((c) => ({
          claimId: c.claimId,
          typeName: c.typeName,
          amountCents: c.amountCents,
          taxable: c.taxable ?? false,
        })),
      cpfStateBefore,
      cpfStateSource,
      monthBefore,
      awRecoveryOpen: awLots(topUps.filter((u) => u.employeeId === id && u.month <= run.month)),
      fwl:
        settings?.fwlSector && settings.fwlTier
          ? { sector: settings.fwlSector, tier: settings.fwlTier, skill: settings.fwlSkill ?? null }
          : null,
      snapshotIssues,
    });
  }
  return out;
}

/**
 * Open AW top-up employee shares (CPF Act s 7(9) recovery lots), oldest first: each run's own share
 * less what that run recovered, then later recoveries of earlier lots applied first-in, first-out.
 */
function awLots(slips: { month: string; result: PayResult }[]): PayInput["awRecoveryOpen"] {
  const sorted = [...slips].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const lots: { month: string; openCents: number; deadline: string }[] = [];
  for (const s of sorted) {
    const t = s.result.awTopUp;
    if (!t) continue;
    let later = t.recoveredEarlierCents;
    for (const lot of lots) {
      const take = Math.min(lot.openCents, later);
      lot.openCents -= take;
      later -= take;
    }
    const open = t.employeeShareCents - t.recoveredThisRunCents;
    if (open > 0) lots.push({ month: s.month, openCents: open, deadline: t.deadline });
  }
  return lots.filter((l) => l.openCents > 0);
}
