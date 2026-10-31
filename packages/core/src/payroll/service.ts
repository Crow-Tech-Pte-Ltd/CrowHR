import { computeSdlTotal, publicHolidays } from "@crowhr/sg-rules";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { allowanceTypes, employees } from "../db/schema/employees.ts";
import { companyProfiles } from "../db/schema/organisation.ts";
import {
  type PayrollRun,
  payrollAllowanceSettings,
  payrollBackpayNotices,
  payrollPayslips,
  payrollRunItems,
  payrollRuns,
  payrollSettings,
  type RunTotals,
} from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { singaporeToday } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { submitApproval, withdrawSubject } from "../workflows/engine.ts";
import { canonicalHash } from "./engine/canonical.ts";
import { computeEmployeePay } from "./engine/compute.ts";
import { dateLabel, dayOfWeek, daysInMonth, maxDate, monthBounds, monthLabel } from "./engine/dates.ts";
import type { PayInput, PayIssue, PayResult, RunItemKind } from "./engine/types.ts";
import { missingPayslipItems } from "./payslip.ts";
import { type ApprovalDecision, payrollPorts } from "./ports.ts";
import { DEDUCTION_CATEGORIES, type DeductionCategory, EA_S21, EA_S25, salaryDueBy } from "./rules.ts";
import { buildSnapshots, replacedChain, runEmployeeIds } from "./snapshot.ts";

/** Who is acting (built from the request by the routes; jobs and tests build it directly). */
export interface PayrollActor {
  orgId: string;
  userId: string;
  membershipId: string;
  employeeId: string | null;
  isOwner: boolean;
  audit: AuditContext;
}

const ACTIVE = ["draft", "in_review"] as const;

function conflict(message: string, details?: unknown): never {
  throw new AppError("conflict", message, details);
}

export async function loadRun(db: Db, orgId: string, runId: string): Promise<PayrollRun> {
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.orgId, orgId), eq(payrollRuns.id, runId)));
  if (!run) throw new AppError("not_found", "That payroll run doesn't exist or you can't see it.");
  return run;
}

function assertDraft(run: PayrollRun) {
  if (run.status !== "draft") {
    conflict(
      run.status === "in_review"
        ? "This run is in review. Withdraw it to draft before changing it."
        : "This run is approved and locked. Reopen it to make an adjustment; the original figures are kept.",
    );
  }
}

// ---------------------------------------------------------------------------
// Settings

export interface PayrollSettingsView {
  payDay: number | null;
  cutoffDay: number | null;
  autoRelease: boolean;
  cpfAdviceCode: string;
  fwlSector: string | null;
  fwlTier: string | null;
  fwlSkill: string | null;
  debitBankBic: string | null;
  debitAccountMasked: string | null;
  debitAccountName: string | null;
}

export async function getSettings(db: Db, orgId: string): Promise<PayrollSettingsView> {
  const [s] = await db.select().from(payrollSettings).where(eq(payrollSettings.orgId, orgId));
  return {
    payDay: s?.payDay ?? null,
    cutoffDay: s?.cutoffDay ?? null,
    autoRelease: s?.autoRelease ?? false,
    cpfAdviceCode: s?.cpfAdviceCode ?? "01",
    fwlSector: s?.fwlSector ?? null,
    fwlTier: s?.fwlTier ?? null,
    fwlSkill: s?.fwlSkill ?? null,
    debitBankBic: s?.debitBankBic ?? null,
    debitAccountMasked: s?.debitAccountLast4 ? `••••${s.debitAccountLast4}` : null,
    debitAccountName: s?.debitAccountName ?? null,
  };
}

export interface SettingsInput {
  payDay?: number | null;
  cutoffDay?: number | null;
  autoRelease?: boolean;
  cpfAdviceCode?: string;
  fwlSector?: string | null;
  fwlTier?: string | null;
  fwlSkill?: string | null;
  debitBankBic?: string | null;
  debitAccountNumber?: string | null;
  debitAccountName?: string | null;
}

export async function updateSettings(deps: AppDeps, actor: PayrollActor, input: SettingsInput) {
  const patch: Partial<typeof payrollSettings.$inferInsert> = {};
  for (const k of [
    "payDay",
    "cutoffDay",
    "autoRelease",
    "cpfAdviceCode",
    "fwlSector",
    "fwlTier",
    "fwlSkill",
    "debitBankBic",
    "debitAccountName",
  ] as const) {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
  }
  if (input.debitAccountNumber !== undefined) {
    const digits = input.debitAccountNumber?.replace(/\D/g, "") ?? null;
    patch.debitAccountEnc = digits ? await deps.secretBox.encrypt("bank-account", digits) : null;
    patch.debitAccountLast4 = digits ? digits.slice(-4) : null;
  }
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(payrollSettings)
      .values({ orgId: actor.orgId, ...patch, updatedAt: deps.clock.now() })
      .onConflictDoUpdate({ target: payrollSettings.orgId, set: { ...patch, updatedAt: deps.clock.now() } });
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.settings_updated",
      targetType: "payroll_settings",
      targetId: actor.orgId,
      diff: Object.fromEntries(
        Object.keys(input).map((k) => [
          k,
          k === "debitAccountNumber" ? { changed: true as const } : { to: (input as Record<string, unknown>)[k] },
        ]),
      ),
    });
  });
  return getSettings(deps.db, actor.orgId);
}

export async function listAllowanceSettings(db: Db, orgId: string) {
  const rows = await db
    .select({ type: allowanceTypes, s: payrollAllowanceSettings })
    .from(allowanceTypes)
    .leftJoin(
      payrollAllowanceSettings,
      and(
        eq(payrollAllowanceSettings.orgId, allowanceTypes.orgId),
        eq(payrollAllowanceSettings.allowanceTypeId, allowanceTypes.id),
      ),
    )
    .where(eq(allowanceTypes.orgId, orgId));
  return rows
    .map(({ type, s }) => ({
      allowanceTypeId: type.id,
      code: type.code,
      name: type.name,
      cpfLiable: s?.cpfLiable ?? true,
      prorate: s?.prorate ?? true,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function setAllowanceSetting(
  deps: AppDeps,
  actor: PayrollActor,
  allowanceTypeId: string,
  input: { cpfLiable: boolean; prorate: boolean },
) {
  const [type] = await deps.db
    .select()
    .from(allowanceTypes)
    .where(and(eq(allowanceTypes.orgId, actor.orgId), eq(allowanceTypes.id, allowanceTypeId)));
  if (!type) throw new AppError("not_found", "That allowance type doesn't exist or you can't see it.");
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(payrollAllowanceSettings)
      .values({ orgId: actor.orgId, allowanceTypeId, ...input })
      .onConflictDoUpdate({
        target: [payrollAllowanceSettings.orgId, payrollAllowanceSettings.allowanceTypeId],
        set: { ...input, updatedAt: deps.clock.now() },
      });
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.allowance_setting_updated",
      targetType: "allowance_type",
      targetId: allowanceTypeId,
      diff: { cpfLiable: { to: input.cpfLiable }, prorate: { to: input.prorate } },
    });
  });
  return (await listAllowanceSettings(deps.db, actor.orgId)).find((a) => a.allowanceTypeId === allowanceTypeId);
}

// ---------------------------------------------------------------------------
// Runs

export interface CreateRunInput {
  kind: "regular" | "off_cycle";
  month: string;
  payDate?: string | null;
  offCycleReason?: "final_pay" | "bonus" | null;
  employeeIds?: string[] | null;
}

export function defaultPayDate(month: string, payDay: number | null): string {
  const { end } = monthBounds(month);
  if (payDay === null) return end;
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(Math.min(payDay, daysInMonth(y, m))).padStart(2, "0")}`;
}

export async function createRun(deps: AppDeps, actor: PayrollActor, input: CreateRunInput): Promise<PayrollRun> {
  const { db } = deps;
  const { start, end } = monthBounds(input.month);
  const settings = await getSettings(db, actor.orgId);
  const payDate = input.payDate ?? defaultPayDate(input.month, settings.payDay);
  if (payDate < start)
    throw new AppError("validation_failed", "The pay date must be on or after the start of the period.", {
      issues: [{ path: "payDate", message: "Choose a date on or after the first day of the month." }],
    });
  let employeeIds: string[] | null = null;
  if (input.kind === "off_cycle") {
    if (!input.offCycleReason)
      throw new AppError("validation_failed", "Choose why this off-cycle run is needed: final pay or bonus.", {
        issues: [{ path: "offCycleReason", message: "Choose final pay or bonus." }],
      });
    const ids = [...new Set(input.employeeIds ?? [])].sort();
    if (ids.length === 0)
      throw new AppError("validation_failed", "Choose at least one employee for an off-cycle run.", {
        issues: [{ path: "employeeIds", message: "Choose at least one employee." }],
      });
    const found = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.orgId, actor.orgId), inArray(employees.id, ids)));
    if (found.length !== ids.length)
      throw new AppError("not_found", "One of those employees doesn't exist or you can't see them.");
    if (input.offCycleReason === "final_pay") {
      const regular = await db
        .select({ id: payrollRuns.id, status: payrollRuns.status })
        .from(payrollRuns)
        .where(
          and(eq(payrollRuns.orgId, actor.orgId), eq(payrollRuns.month, input.month), eq(payrollRuns.kind, "regular")),
        );
      const locked = regular.find((r) => r.status === "approved" || r.status === "paid");
      if (locked) {
        const inIt = await db
          .select({ employeeId: payrollPayslips.employeeId })
          .from(payrollPayslips)
          .where(
            and(
              eq(payrollPayslips.orgId, actor.orgId),
              eq(payrollPayslips.runId, locked.id),
              inArray(payrollPayslips.employeeId, ids),
            ),
          );
        if (inIt.length > 0)
          conflict(
            `${monthLabel(input.month)}'s regular payroll already paid ${inIt.length === 1 ? "this employee" : "these employees"}. Reopen it to adjust their final pay instead.`,
          );
      }
    }
    employeeIds = ids;
  } else {
    const [existing] = await db
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(
        and(eq(payrollRuns.orgId, actor.orgId), eq(payrollRuns.month, input.month), eq(payrollRuns.kind, "regular")),
      );
    if (existing)
      conflict(
        `There is already a regular payroll run for ${monthLabel(input.month)}. Open it, or reopen it to make an adjustment.`,
        { runId: existing.id },
      );
  }
  const id = deps.ids.newId();
  const now = deps.clock.now();
  await db.transaction(async (tx) => {
    await tx.insert(payrollRuns).values({
      id,
      orgId: actor.orgId,
      kind: input.kind,
      offCycleReason: input.kind === "off_cycle" ? (input.offCycleReason ?? null) : null,
      month: input.month,
      periodStart: start,
      periodEnd: end,
      payDate,
      employeeIds,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_created",
      targetType: "payroll_run",
      targetId: id,
      meta: {
        kind: input.kind,
        month: input.month,
        offCycleReason: input.offCycleReason ?? null,
        employees: employeeIds?.length ?? null,
      },
    });
  });
  return loadRun(db, actor.orgId, id);
}

export async function updateRun(deps: AppDeps, actor: PayrollActor, runId: string, input: { payDate: string }) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  assertDraft(run);
  if (input.payDate < run.periodStart)
    throw new AppError("validation_failed", "The pay date must be on or after the start of the period.", {
      issues: [{ path: "payDate", message: "Choose a date on or after the first day of the month." }],
    });
  await deps.db.transaction(async (tx) => {
    await tx
      .update(payrollRuns)
      .set({ payDate: input.payDate, inputsChangedAt: deps.clock.now(), updatedAt: deps.clock.now() })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_updated",
      targetType: "payroll_run",
      targetId: run.id,
      diff: { payDate: { from: run.payDate, to: input.payDate } },
    });
  });
  return loadRun(deps.db, actor.orgId, runId);
}

export async function deleteRun(deps: AppDeps, actor: PayrollActor, runId: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  assertDraft(run);
  await deps.db.transaction(async (tx) => {
    await payrollPorts(deps).reimbursements.release(tx, actor.orgId, run.id);
    await tx.delete(payrollRuns).where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_deleted",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { month: run.month, kind: run.kind },
    });
  });
}

// ---------------------------------------------------------------------------
// Items

export interface ItemInput {
  employeeId: string;
  kind: RunItemKind;
  label: string;
  amountCents?: number | null;
  wageClass?: "OW" | "AW" | null;
  cpfLiable?: boolean;
  awPayableDate?: string | null;
  minutes?: number | null;
  days?: number | null;
  date?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  deductionCategory?: DeductionCategory | null;
}

function validateItem(run: PayrollRun, input: ItemInput) {
  const issues: { path: string; message: string }[] = [];
  const needsAmount = ["bonus", "commission", "backpay", "other_earning", "deduction"].includes(input.kind);
  if (needsAmount && (input.amountCents === null || input.amountCents === undefined || input.amountCents <= 0)) {
    issues.push({ path: "amountCents", message: "Enter an amount greater than S$0.00." });
  }
  if ((input.kind === "overtime" || input.kind === "hours") && !(input.minutes && input.minutes > 0)) {
    issues.push({ path: "minutes", message: "Enter the time in minutes, more than 0." });
  }
  if (
    (input.kind === "scheduled_days" || input.kind === "days_worked") &&
    !(input.days !== null && input.days !== undefined && input.days >= 0 && Number.isInteger(input.days * 2))
  ) {
    issues.push({ path: "days", message: "Enter the number of days in half days (e.g. 22 or 21.5)." });
  }
  if (input.kind === "unpaid_leave" && !(input.days && input.days > 0 && Number.isInteger(input.days * 2))) {
    issues.push({ path: "days", message: "Enter the days of no-pay leave in half days (e.g. 1 or 1.5)." });
  }
  if (input.kind === "deduction" && !input.deductionCategory) {
    issues.push({
      path: "deductionCategory",
      message: `Choose the deduction category (${Object.values(DEDUCTION_CATEGORIES)
        .map((c) => c.label)
        .join(", ")}).`,
    });
  }
  if (input.wageClass === "AW" && !input.awPayableDate) {
    issues.push({
      path: "awPayableDate",
      message: `Enter the date this AW became due and payable (${dateLabel(run.periodStart)}–${dateLabel(run.periodEnd)}).`,
    });
  }
  if (input.date && (input.date < run.periodStart || input.date > run.periodEnd)) {
    issues.push({
      path: "date",
      message: `Choose a date within the period (${dateLabel(run.periodStart)}–${dateLabel(run.periodEnd)}).`,
    });
  }
  if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) {
    issues.push({ path: "periodEnd", message: "The overtime period must end on or after it starts." });
  }
  if (issues.length) throw new AppError("validation_failed", issues[0]?.message ?? "Check the item.", { issues });
}

function itemValues(input: ItemInput) {
  return {
    employeeId: input.employeeId,
    kind: input.kind,
    label: input.label.trim(),
    amountCents: input.amountCents ?? null,
    wageClass:
      input.wageClass ??
      (["bonus"].includes(input.kind)
        ? "AW"
        : ["commission", "backpay", "other_earning"].includes(input.kind)
          ? "OW"
          : null),
    cpfLiable: input.cpfLiable ?? true,
    awPayableDate: input.awPayableDate ?? null,
    minutes: input.minutes ?? null,
    halfDays: input.days === null || input.days === undefined ? null : Math.round(input.days * 2),
    itemDate: input.date ?? null,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    deductionCategory: input.deductionCategory ?? null,
  };
}

async function assertEmployeeInRun(db: Db, run: PayrollRun, employeeId: string) {
  const ids = await runEmployeeIds(db, run);
  if (!ids.includes(employeeId)) throw new AppError("not_found", "That employee isn't in this payroll run.");
}

export async function addItem(deps: AppDeps, actor: PayrollActor, runId: string, input: ItemInput) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  assertDraft(run);
  await assertEmployeeInRun(deps.db, run, input.employeeId);
  validateItem(run, input);
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    await tx.insert(payrollRunItems).values({
      id,
      orgId: actor.orgId,
      runId: run.id,
      ...itemValues(input),
      createdBy: actor.userId,
      createdAt: deps.clock.now(),
    });
    await tx
      .update(payrollRuns)
      .set({ inputsChangedAt: deps.clock.now(), updatedAt: deps.clock.now() })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.item_added",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { itemId: id, employeeId: input.employeeId, kind: input.kind },
      diff: { amountCents: { changed: true } },
    });
  });
  return id;
}

export async function updateItem(deps: AppDeps, actor: PayrollActor, runId: string, itemId: string, input: ItemInput) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  assertDraft(run);
  const [existing] = await deps.db
    .select()
    .from(payrollRunItems)
    .where(
      and(eq(payrollRunItems.orgId, actor.orgId), eq(payrollRunItems.runId, run.id), eq(payrollRunItems.id, itemId)),
    );
  if (!existing) throw new AppError("not_found", "That pay item doesn't exist or you can't see it.");
  await assertEmployeeInRun(deps.db, run, input.employeeId);
  validateItem(run, input);
  await deps.db.transaction(async (tx) => {
    await tx.update(payrollRunItems).set(itemValues(input)).where(eq(payrollRunItems.id, itemId));
    await tx
      .update(payrollRuns)
      .set({ inputsChangedAt: deps.clock.now(), updatedAt: deps.clock.now() })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.item_updated",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { itemId, kind: input.kind },
      diff: { amountCents: { changed: true } },
    });
  });
}

export async function deleteItem(deps: AppDeps, actor: PayrollActor, runId: string, itemId: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  assertDraft(run);
  const [existing] = await deps.db
    .select()
    .from(payrollRunItems)
    .where(
      and(eq(payrollRunItems.orgId, actor.orgId), eq(payrollRunItems.runId, run.id), eq(payrollRunItems.id, itemId)),
    );
  if (!existing) throw new AppError("not_found", "That pay item doesn't exist or you can't see it.");
  await deps.db.transaction(async (tx) => {
    await tx.delete(payrollRunItems).where(eq(payrollRunItems.id, itemId));
    await tx
      .update(payrollRuns)
      .set({ inputsChangedAt: deps.clock.now(), updatedAt: deps.clock.now() })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.item_deleted",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { itemId, kind: existing.kind },
    });
  });
}

// ---------------------------------------------------------------------------
// Compute

interface Computed {
  input: PayInput;
  inputHash: string;
  result: PayResult;
  resultHash: string;
}

async function computeAll(deps: AppDeps, run: PayrollRun): Promise<{ computed: Computed[]; claimIds: string[] }> {
  const ports = payrollPorts(deps);
  const claims =
    run.kind === "off_cycle" && run.offCycleReason === "bonus"
      ? []
      : await ports.reimbursements.listPayable(run.orgId, run.periodEnd, { runId: run.id });
  const overtime =
    run.kind === "off_cycle" && run.offCycleReason === "bonus"
      ? []
      : await ports.overtime.listApproved(run.orgId, run.periodStart, run.periodEnd);
  const bonusOnly = run.kind === "off_cycle" && run.offCycleReason === "bonus";
  const unpaidLeave = bonusOnly ? [] : await ports.unpaidLeave.listUnpaid(run.orgId, run.periodStart, run.periodEnd);
  const daysWorked = bonusOnly ? [] : await ports.daysWorked.listDaysWorked(run.orgId, run.periodStart, run.periodEnd);
  const scheduledDays = bonusOnly
    ? []
    : await ports.scheduledDays.listScheduledDays(run.orgId, run.periodStart, run.periodEnd);
  const inputs = await buildSnapshots(deps.db, { run, claims, overtime, unpaidLeave, daysWorked, scheduledDays });
  const computed: Computed[] = [];
  for (const input of inputs) {
    const result = computeEmployeePay(input);
    computed.push({ input, inputHash: await canonicalHash(input), result, resultHash: await canonicalHash(result) });
  }
  const inRun = new Set(inputs.map((i) => i.employee.id));
  return {
    computed,
    claimIds: claims
      .filter((c) => inRun.has(c.employeeId))
      .map((c) => c.claimId)
      .sort(),
  };
}

async function runInputHash(run: PayrollRun, computed: Computed[]): Promise<string> {
  return canonicalHash({ payDate: run.payDate, employees: computed.map((c) => [c.input.employee.id, c.inputHash]) });
}

async function runLevelIssues(db: Db, run: PayrollRun, headcount: number): Promise<PayIssue[]> {
  const issues: PayIssue[] = [];
  const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.orgId, run.orgId));
  const missing = [
    !profile?.legalName && "legal name",
    !profile?.uen && "UEN",
    !profile?.csn && "CPF Submission Number (CSN)",
    !(profile?.addressStreet && profile.postalCode) && "registered address",
  ].filter(Boolean);
  if (missing.length) {
    issues.push({
      code: "COMPANY_PROFILE_INCOMPLETE",
      severity: "blocking",
      message: `Payroll can't be finalised until the company profile has its ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} in Settings → Company.`,
      source: null,
    });
  }
  if (headcount === 0) {
    issues.push({
      code: "NO_EMPLOYEES",
      severity: "blocking",
      message: `Nobody is employed in ${monthLabel(run.month)} for this run. Check hire dates in People.`,
      source: null,
    });
  }
  const due = salaryDueBy(run.periodEnd);
  if (run.payDate > due) {
    issues.push({
      code: "EA_SALARY_PAID_LATE",
      severity: "warning",
      message: `Salary must be paid within 7 days after the salary period ends (by ${dateLabel(due)}; EA s 21, calendar days). The pay date is ${dateLabel(run.payDate)}.`,
      source: EA_S21,
    });
  }
  const dow = dayOfWeek(run.payDate);
  let holiday: string | null = null;
  try {
    holiday =
      publicHolidays(Number(run.payDate.slice(0, 4))).find(
        (h) => h.date === run.payDate || h.observedOn === run.payDate,
      )?.name ?? null;
  } catch {
    holiday = null;
  }
  if (dow === 0 || dow === 6 || holiday) {
    issues.push({
      code: "PAY_DATE_NOT_WORKING_DAY",
      severity: "info",
      message: `The pay date ${dateLabel(run.payDate)} is ${holiday ? `a public holiday (${holiday})` : dow === 0 ? "a Sunday" : "a Saturday"}. Payment into the employee's bank account may be made on any day (EA s 25(2)), but some transfers only credit on the next banking day; cash and cheque must be paid on a working day.`,
      source: EA_S25,
    });
  }
  const unfinished = await db
    .select({ month: payrollRuns.month })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, run.orgId),
        eq(payrollRuns.kind, "regular"),
        inArray(payrollRuns.status, ["draft", "in_review"]),
        ne(payrollRuns.id, run.id),
      ),
    );
  const earlierOpen = unfinished
    .map((r) => r.month)
    .filter((m) => m < run.month && m.slice(0, 4) === run.month.slice(0, 4))
    .sort();
  if (earlierOpen.length) {
    issues.push({
      code: "EARLIER_MONTH_NOT_FINALISED",
      severity: "warning",
      message: `${monthLabel(earlierOpen[0] as string)} payroll is not approved yet, so this run's CPF year-to-date figures leave it out. Approve the earlier month first, then recompute this run.`,
      source: null,
    });
  }
  if (run.kind === "adjustment") {
    const [later] = await db
      .select({ id: payrollRuns.id, month: payrollRuns.month })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.orgId, run.orgId),
          inArray(payrollRuns.status, ["approved", "paid"]),
          ne(payrollRuns.id, run.id),
        ),
      )
      .orderBy(desc(payrollRuns.month))
      .limit(1);
    if (later && later.month > run.month && later.month.slice(0, 4) === run.month.slice(0, 4)) {
      issues.push({
        code: "ADJUSTMENT_LATER_MONTHS",
        severity: "warning",
        message: `${monthLabel(later.month)} was already finalised with CPF year-to-date figures from before this adjustment. The AW ceiling is reconciled again in December or the last month of employment.`,
        source: null,
      });
    }
  }
  return issues;
}

async function totalsFor(db: Db, run: PayrollRun, computed: Computed[], runIssues: PayIssue[]): Promise<RunTotals> {
  const t: RunTotals = {
    headcount: computed.length,
    grossCents: 0,
    netCents: 0,
    netPayableCents: 0,
    reimbursementsCents: 0,
    cpfEmployeeCents: 0,
    cpfEmployerCents: 0,
    cpfEmployeeShareAbsorbedCents: 0,
    cpfAwRecoveredCents: 0,
    cpfTotalChargedCents: 0,
    shgCents: 0,
    shgChargedByFund: {},
    shgDonors: {},
    sdlChargedCents: 0,
    sdlMonthCents: 0,
    fwlCents: 0,
    employerCostCents: 0,
    blocking: runIssues.filter((i) => i.severity === "blocking").length,
    warnings: runIssues.filter((i) => i.severity === "warning").length,
  };
  for (const { result: r } of computed) {
    t.grossCents += r.totals.grossCents;
    t.netCents += r.totals.netCents;
    t.netPayableCents += r.totals.netPayableCents;
    t.reimbursementsCents += r.totals.reimbursementsCents;
    t.cpfEmployeeCents += r.totals.cpfEmployeeCents;
    t.cpfEmployerCents += r.totals.cpfEmployerCents;
    t.cpfTotalChargedCents += r.charged.cpfTotalCents;
    t.cpfEmployeeShareAbsorbedCents =
      (t.cpfEmployeeShareAbsorbedCents ?? 0) + (r.totals.cpfEmployeeShareAbsorbedCents ?? 0);
    t.cpfAwRecoveredCents = (t.cpfAwRecoveredCents ?? 0) + (r.totals.cpfAwRecoveredCents ?? 0);
    t.shgCents += r.totals.shgCents;
    for (const [f, v] of Object.entries(r.charged.shgCents)) {
      t.shgChargedByFund[f] = (t.shgChargedByFund[f] ?? 0) + (v ?? 0);
      if ((v ?? 0) > 0) t.shgDonors[f] = (t.shgDonors[f] ?? 0) + 1;
    }
    t.fwlCents += r.totals.fwlCents;
    t.blocking += r.issues.filter((i) => i.severity === "blocking").length;
    t.warnings += r.issues.filter((i) => i.severity === "warning").length;
  }
  // SDL: employer total for the month, rounded once (sg-rules computeSdlTotal), less what earlier runs charged.
  const others = await db
    .select({ id: payrollRuns.id, totals: payrollRuns.totals, superseded: payrollRuns.supersededByRunId })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, run.orgId),
        eq(payrollRuns.month, run.month),
        inArray(payrollRuns.status, ["approved", "paid"]),
        ne(payrollRuns.id, run.id),
      ),
    );
  const inThisRun = new Set(computed.map((c) => c.input.employee.id));
  const chain = new Set(await replacedChain(db, run.orgId, run));
  const latestUnits = new Map<string, number>();
  if (others.length > 0) {
    const slips = await db
      .select({ employeeId: payrollPayslips.employeeId, runId: payrollPayslips.runId, result: payrollPayslips.result })
      .from(payrollPayslips)
      .where(
        and(
          eq(payrollPayslips.orgId, run.orgId),
          inArray(
            payrollPayslips.runId,
            others.map((o) => o.id),
          ),
        ),
      );
    for (const s of slips) {
      const o = others.find((x) => x.id === s.runId);
      if (!o || o.superseded || chain.has(o.id) || inThisRun.has(s.employeeId)) continue;
      latestUnits.set(s.employeeId, Math.max(latestUnits.get(s.employeeId) ?? 0, s.result.month.sdlUnits1e4Cent));
    }
  }
  const units = [...computed.map((c) => c.result.month.sdlUnits1e4Cent), ...latestUnits.values()].map((u) => ({
    units1e4Cent: u,
  }));
  t.sdlMonthCents = computeSdlTotal(units).payableCents;
  t.sdlChargedCents = t.sdlMonthCents - others.reduce((s, o) => s + (o.totals?.sdlChargedCents ?? 0), 0);
  t.employerCostCents = t.cpfEmployerCents + (t.cpfEmployeeShareAbsorbedCents ?? 0) + t.sdlChargedCents + t.fwlCents;
  return t;
}

export async function computeRun(deps: AppDeps, actor: PayrollActor, runId: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  assertDraft(run);
  const { computed, claimIds } = await computeAll(deps, run);
  const runIssues = await runLevelIssues(deps.db, run, computed.length);
  const totals = await totalsFor(deps.db, run, computed, runIssues);
  const inputHash = await runInputHash(run, computed);
  const resultHash = await canonicalHash(computed.map((c) => [c.input.employee.id, c.resultHash]));
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const ports = payrollPorts(deps);
    await ports.reimbursements.release(tx, actor.orgId, run.id);
    if (claimIds.length) await ports.reimbursements.reserve(tx, actor.orgId, run.id, claimIds);
    await tx
      .delete(payrollPayslips)
      .where(and(eq(payrollPayslips.orgId, actor.orgId), eq(payrollPayslips.runId, run.id)));
    for (const c of computed) {
      await tx.insert(payrollPayslips).values({
        id: deps.ids.newId(),
        orgId: actor.orgId,
        runId: run.id,
        employeeId: c.input.employee.id,
        employeeNumber: c.input.employee.employeeNumber,
        employeeName: c.input.employee.legalName,
        input: c.input,
        inputHash: c.inputHash,
        result: c.result,
        resultHash: c.resultHash,
        grossCents: c.result.totals.grossCents,
        netCents: c.result.totals.netCents,
        netPayableCents: c.result.totals.netPayableCents,
        cpfEmployeeCents: c.result.totals.cpfEmployeeCents,
        cpfEmployerCents: c.result.totals.cpfEmployerCents,
        blockingCount: c.result.issues.filter((i) => i.severity === "blocking").length,
        warningCount: c.result.issues.filter((i) => i.severity === "warning").length,
        createdAt: now,
      });
    }
    await tx
      .update(payrollRuns)
      .set({ computedAt: now, inputHash, resultHash, totals, issues: runIssues, updatedAt: now })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_computed",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { headcount: computed.length, inputHash, resultHash, blocking: totals.blocking, warnings: totals.warnings },
    });
  });
  return loadRun(deps.db, actor.orgId, runId);
}

/** 409 when the live records no longer match what was computed. */
async function assertFresh(deps: AppDeps, run: PayrollRun) {
  if (!run.computedAt || !run.inputHash) conflict("Compute the run before submitting it.");
  const { computed } = await computeAll(deps, run);
  const hash = await runInputHash(run, computed);
  if (hash !== run.inputHash) {
    conflict(
      "Employee records or earlier runs changed after this run was computed. Recompute the run, review the changes, then submit again.",
      { stale: true },
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle

export async function submitRun(deps: AppDeps, actor: PayrollActor, runId: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  assertDraft(run);
  await assertFresh(deps, run);
  const runIssues = await runLevelIssues(deps.db, run, run.totals?.headcount ?? 0);
  const blocking =
    (run.totals?.blocking ?? 0) -
    (run.issues ?? []).filter((i) => i.severity === "blocking").length +
    runIssues.filter((i) => i.severity === "blocking").length;
  if (blocking > 0) {
    conflict(
      `Resolve the ${blocking} blocking ${blocking === 1 ? "issue" : "issues"} first; they are listed at the top of the run.`,
      { blocking },
    );
  }
  await deps.db.transaction(async (tx) => {
    await tx
      .update(payrollRuns)
      .set({
        status: "in_review",
        submittedBy: actor.userId,
        submittedAt: deps.clock.now(),
        decisionComment: null,
        updatedAt: deps.clock.now(),
      })
      .where(eq(payrollRuns.id, run.id));
    const { requestId } = await submitApproval(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "payroll_run",
      subjectId: run.id,
      requesterMembershipId: actor.membershipId,
      requesterEmployeeId: actor.employeeId,
      attributes: { amountCents: run.totals?.netPayableCents ?? 0, typeCode: run.kind },
    });
    await tx.update(payrollRuns).set({ approvalRequestId: requestId }).where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_submitted",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { approvalRequestId: requestId, inputHash: run.inputHash },
    });
  });
  return loadRun(deps.db, actor.orgId, runId);
}

export async function withdrawRun(deps: AppDeps, actor: PayrollActor, runId: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  if (run.status !== "in_review") conflict("Only a run in review can be withdrawn to draft.");
  await deps.db.transaction(async (tx) => {
    await withdrawSubject(tx, deps, actor.audit, { orgId: actor.orgId, subjectType: "payroll_run", subjectId: run.id });
    await tx
      .update(payrollRuns)
      .set({ status: "draft", approvalRequestId: null, updatedAt: deps.clock.now() })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_withdrawn",
      targetType: "payroll_run",
      targetId: run.id,
    });
  });
  return loadRun(deps.db, actor.orgId, runId);
}

/**
 * The approval adapter's state change, inside the caller's (the engine's) transaction. Exported for
 * `approval.ts`. Approval locks the run; rejection returns it to draft with the comment.
 */
export async function applyDecision(
  tx: Db,
  deps: AppDeps,
  audit: AuditContext,
  orgId: string,
  runId: string,
  decision: ApprovalDecision,
) {
  const run = await loadRun(tx, orgId, runId);
  if (run.status !== "in_review") conflict("This run is not waiting for a decision.");
  if (decision.outcome === "rejected") {
    await tx
      .update(payrollRuns)
      .set({
        status: "draft",
        approvalRequestId: null,
        decidedBy: decision.decidedByUserId,
        decidedAt: decision.decidedAt,
        decisionComment: decision.comment,
        updatedAt: deps.clock.now(),
      })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, audit, {
      action: "payroll.run_rejected",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { comment: decision.comment },
    });
    return;
  }
  await tx
    .update(payrollRuns)
    .set({
      status: "approved",
      decidedBy: decision.decidedByUserId,
      decidedAt: decision.decidedAt,
      decisionComment: decision.comment,
      selfApproved: decision.selfApproved,
      updatedAt: deps.clock.now(),
    })
    .where(eq(payrollRuns.id, run.id));
  // Back pay paid by this run settles the employee's open back-pay notices.
  const paidBackpay = await tx
    .select({ employeeId: payrollRunItems.employeeId })
    .from(payrollRunItems)
    .where(
      and(eq(payrollRunItems.orgId, orgId), eq(payrollRunItems.runId, run.id), eq(payrollRunItems.kind, "backpay")),
    );
  if (paidBackpay.length) {
    await tx
      .update(payrollBackpayNotices)
      .set({ resolvedRunId: run.id })
      .where(
        and(
          eq(payrollBackpayNotices.orgId, orgId),
          inArray(payrollBackpayNotices.employeeId, [...new Set(paidBackpay.map((b) => b.employeeId))]),
          isNull(payrollBackpayNotices.resolvedRunId),
        ),
      );
  }
  if (run.kind === "adjustment" && run.adjustsRunId) {
    await tx
      .update(payrollRuns)
      .set({ supersededByRunId: run.id, updatedAt: deps.clock.now() })
      .where(and(eq(payrollRuns.orgId, orgId), eq(payrollRuns.id, run.adjustsRunId)));
  }
  await recordAudit(tx, deps, audit, {
    action: "payroll.run_approved",
    targetType: "payroll_run",
    targetId: run.id,
    meta: { selfApproved: decision.selfApproved, resultHash: run.resultHash, supersedes: run.adjustsRunId },
  });
  const [s] = await tx.select().from(payrollSettings).where(eq(payrollSettings.orgId, orgId));
  if (s?.autoRelease) {
    const missing = await releaseProblems(tx, orgId, run.id);
    if (missing.length === 0) await doRelease(tx, deps, audit, orgId, run.id, decision.decidedByUserId, true);
  }
}

async function releaseProblems(db: Db, orgId: string, runId: string) {
  const slips = await db
    .select()
    .from(payrollPayslips)
    .where(and(eq(payrollPayslips.orgId, orgId), eq(payrollPayslips.runId, runId)));
  const problems: { employeeName: string; missing: string[] }[] = [];
  for (const s of slips) {
    const missing = missingPayslipItems(s.input, s.result);
    if (missing.length) problems.push({ employeeName: s.employeeName, missing });
  }
  return problems;
}

async function doRelease(
  tx: Db,
  deps: AppDeps,
  audit: AuditContext,
  orgId: string,
  runId: string,
  userId: string,
  auto: boolean,
) {
  const now = deps.clock.now();
  await tx
    .update(payrollRuns)
    .set({ releasedAt: now, releasedBy: userId, updatedAt: now })
    .where(and(eq(payrollRuns.orgId, orgId), eq(payrollRuns.id, runId)));
  await tx
    .update(payrollPayslips)
    .set({ releasedAt: now })
    .where(and(eq(payrollPayslips.orgId, orgId), eq(payrollPayslips.runId, runId)));
  await recordAudit(tx, deps, audit, {
    action: "payslip.released",
    targetType: "payroll_run",
    targetId: runId,
    meta: { auto },
  });
}

export async function releaseRun(deps: AppDeps, actor: PayrollActor, runId: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  if (run.status !== "approved" && run.status !== "paid")
    conflict("Payslips can be released only after the run is approved.");
  if (run.releasedAt) return run;
  const problems = await releaseProblems(deps.db, actor.orgId, run.id);
  if (problems.length) {
    const first = problems[0] as { employeeName: string; missing: string[] };
    throw new AppError(
      "conflict",
      `Payslips can't be released: ${first.employeeName}'s payslip is missing ${first.missing.join(", ")}. ${first.missing.includes("Employer's full name") ? "Add the legal name in Settings → Company." : "Fix the record and reopen the run."}`,
      { problems },
    );
  }
  await deps.db.transaction(async (tx) => doRelease(tx, deps, actor.audit, actor.orgId, run.id, actor.userId, false));
  return loadRun(deps.db, actor.orgId, runId);
}

export async function markPaid(deps: AppDeps, actor: PayrollActor, runId: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  if (run.status !== "approved")
    conflict(run.status === "paid" ? "This run is already marked paid." : "Approve the run before marking it paid.");
  await deps.db.transaction(async (tx) => {
    await payrollPorts(deps).reimbursements.markPaid(tx, actor.orgId, run.id, run.payDate);
    await tx
      .update(payrollRuns)
      .set({ status: "paid", paidAt: deps.clock.now(), paidBy: actor.userId, updatedAt: deps.clock.now() })
      .where(eq(payrollRuns.id, run.id));
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_paid",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { payDate: run.payDate },
    });
  });
  return loadRun(deps.db, actor.orgId, runId);
}

/** Reopen = a new adjustment run starting from a copy of the original's items. The original never changes. */
export async function reopenRun(deps: AppDeps, actor: PayrollActor, runId: string, reason: string) {
  const run = await loadRun(deps.db, actor.orgId, runId);
  if (run.status !== "approved" && run.status !== "paid")
    conflict("Only an approved or paid run can be reopened. A draft can be edited directly.");
  if (run.supersededByRunId)
    conflict("This run was already corrected by a later adjustment. Reopen that adjustment instead.", {
      runId: run.supersededByRunId,
    });
  const [open] = await deps.db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, actor.orgId),
        eq(payrollRuns.adjustsRunId, run.id),
        inArray(payrollRuns.status, [...ACTIVE]),
      ),
    );
  if (open) conflict("An adjustment of this run is already open.", { runId: open.id });
  if (!reason.trim())
    throw new AppError("validation_failed", "Say why the run is being reopened.", {
      issues: [{ path: "reason", message: "Add a reason, e.g. 'Missed transport allowance for Ravi'." }],
    });
  const slips = await deps.db
    .select({ employeeId: payrollPayslips.employeeId })
    .from(payrollPayslips)
    .where(and(eq(payrollPayslips.orgId, actor.orgId), eq(payrollPayslips.runId, run.id)));
  const items = await deps.db
    .select()
    .from(payrollRunItems)
    .where(and(eq(payrollRunItems.orgId, actor.orgId), eq(payrollRunItems.runId, run.id)));
  const today = singaporeToday(deps.clock.now());
  const id = deps.ids.newId();
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx.insert(payrollRuns).values({
      id,
      orgId: actor.orgId,
      kind: "adjustment",
      offCycleReason: run.offCycleReason,
      month: run.month,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      payDate: maxDate(today, run.payDate),
      employeeIds: slips.map((s) => s.employeeId).sort(),
      adjustsRunId: run.id,
      reopenReason: reason.trim(),
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    for (const i of items.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      await tx.insert(payrollRunItems).values({
        ...i,
        id: deps.ids.newId(),
        runId: id,
        copiedFromItemId: i.id,
        createdBy: actor.userId,
        createdAt: now,
      });
    }
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.run_reopened",
      targetType: "payroll_run",
      targetId: run.id,
      meta: { adjustmentRunId: id, reason: reason.trim(), items: items.length },
    });
  });
  return loadRun(deps.db, actor.orgId, id);
}
