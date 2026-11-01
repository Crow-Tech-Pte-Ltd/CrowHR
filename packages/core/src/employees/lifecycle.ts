import { checkEmploymentAge, RulesNotAvailableError, statutoryMinimumNotice } from "@crowhr/sg-rules";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import {
  allowanceTypes,
  type CompensationRecord,
  compensationRecords,
  type EmploymentRecord,
  emergencyContacts,
  employees,
  employmentRecords,
  type LifecycleEvent,
  type LifecycleEventType,
  lifecycleEvents,
  recurringAllowances,
  type Tenure,
  tenures,
  workPasses,
} from "../db/schema/employees.ts";
import { workSchedules } from "../db/schema/organisation.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { assertSelectable } from "../organisation/structure.ts";
import { defaultWorkScheduleId } from "../organisation/work-schedules.ts";
import { onReportingLineChanged } from "../workflows/engine.ts";
import { type Actor, assertCanWrite, assertNotSelfChange, canWrite } from "./access.ts";
import { diffOf, recordAudit } from "./audit-helpers.ts";
import { cancelChecklistsForEvent, instantiateChecklist } from "./checklists.ts";
import { normaliseEmail } from "./contact.ts";
import { addDays, displayDate, displayMonth, singaporeToday } from "./dates.ts";
import { findAsAt, planInsert } from "./effective.ts";
import { assertIdNumberFree, assertWorkEmailFree, nextEmployeeNumber, phoneOrError, sealIdNumber } from "./person.ts";
import type { HireInvite, PeoplePorts } from "./ports.ts";
import { wouldCreateCycle } from "./reports/reporting-scope.ts";
import {
  allowanceInput,
  type CompensationInput,
  compensationInput,
  type HireInput,
  hireInput,
  isoDate,
  type JobFields,
  jobFields,
  TERMINATION_REASONS,
} from "./schemas.ts";
import { fieldError, isUniqueViolation, parseInput } from "./validation.ts";
import { sealWorkPass } from "./work-pass.ts";

/**
 * Lifecycle events are the only write path for employment and compensation
 * (design decision 3). Each event validates, writes effective-dated rows
 * linked to `event_id`, and is audited, in one transaction that holds a
 * row lock on the employee.
 */

export interface LifecycleCtx {
  deps: AppDeps;
  ports: PeoplePorts;
  actor: Actor;
  today: string;
}

export function ctxFor(deps: AppDeps, ports: PeoplePorts, actor: Actor): LifecycleCtx {
  return { deps, ports, actor, today: singaporeToday(deps.clock.now()) };
}

export type EventStatus = "scheduled" | "effective" | "cancelled";

/** Derived from the date, never stored (design decision 4). */
export function eventStatus(e: Pick<LifecycleEvent, "effectiveDate" | "cancelledAt">, today: string): EventStatus {
  if (e.cancelledAt) return "cancelled";
  return e.effectiveDate > today ? "scheduled" : "effective";
}

export type EmploymentStatus =
  | { code: "not_started"; label: string; since: string }
  | { code: "active"; label: string; since: string }
  | { code: "leaving"; label: string; lastWorkingDay: string }
  | { code: "former"; label: string; lastWorkingDay: string }
  | { code: "no_tenure"; label: string };

export function employmentStatus(tenureRows: readonly Tenure[], today: string): EmploymentStatus {
  const latest = [...tenureRows].sort((a, b) => (a.hireDate < b.hireDate ? 1 : -1))[0];
  if (!latest) return { code: "no_tenure", label: "Not hired" };
  if (latest.hireDate > today) {
    return { code: "not_started", label: `Starts ${displayDate(latest.hireDate)}`, since: latest.hireDate };
  }
  if (latest.lastWorkingDay && latest.lastWorkingDay < today) {
    return { code: "former", label: "Former", lastWorkingDay: latest.lastWorkingDay };
  }
  if (latest.lastWorkingDay) {
    return {
      code: "leaving",
      label: `Leaving ${displayDate(latest.lastWorkingDay)}`,
      lastWorkingDay: latest.lastWorkingDay,
    };
  }
  return { code: "active", label: "Active", since: latest.hireDate };
}

// ---------------------------------------------------------------------------
// Validation helpers

async function lockEmployee(tx: Db, orgId: string, employeeId: string) {
  const org = orgScope(tx, orgId);
  const [row] = await tx.select().from(employees).where(org.whereId(employees, employeeId)).for("update");
  if (!row) throw new AppError("not_found", "No such employee.");
  return row;
}

async function validateJob(
  tx: Db,
  orgId: string,
  employeeId: string,
  job: Partial<JobFields>,
  onDate: string,
): Promise<void> {
  const org = orgScope(tx, orgId);
  if (job.departmentId !== undefined) {
    await assertSelectable(tx, orgId, "departments", job.departmentId, "job.departmentId");
  }
  await assertSelectable(tx, orgId, "teams", job.teamId, "job.teamId");
  await assertSelectable(tx, orgId, "locations", job.locationId, "job.locationId");
  await assertSelectable(tx, orgId, "cost-centres", job.costCentreId, "job.costCentreId");
  if (job.workScheduleId) {
    const [s] = await tx
      .select({ archivedAt: workSchedules.archivedAt })
      .from(workSchedules)
      .where(org.whereId(workSchedules, job.workScheduleId));
    if (!s) throw fieldError("job.workScheduleId", "Choose an existing work schedule.");
    if (s.archivedAt) throw fieldError("job.workScheduleId", "That work schedule is archived. Choose an active one.");
  }
  if (job.managerEmployeeId) {
    if (job.managerEmployeeId === employeeId) {
      throw new AppError("validation_failed", "An employee cannot be their own manager.", {
        target: "json",
        issues: [{ path: "job.managerEmployeeId", message: "Choose someone else as manager." }],
      });
    }
    const [m] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(org.whereId(employees, job.managerEmployeeId));
    if (!m) throw fieldError("job.managerEmployeeId", "Choose an existing employee as manager.");
    if (await wouldCreateCycle(tx, orgId, employeeId, job.managerEmployeeId, onDate)) {
      throw new AppError(
        "reporting_cycle",
        "This manager reports, directly or indirectly, to this employee. Choose a manager outside their team.",
      );
    }
  }
}

/** A foreigner needs a pass valid on `date` (spec: employees / Work passes). */
async function assertPassValidOn(tx: Db, orgId: string, employeeId: string, date: string) {
  const org = orgScope(tx, orgId);
  const passes = await tx
    .select()
    .from(workPasses)
    .where(org.where(workPasses, eq(workPasses.employeeId, employeeId)));
  const ok = passes.some(
    (p) => (!p.issuedOn || p.issuedOn <= date) && p.expiresOn >= date && (!p.cancelledOn || p.cancelledOn > date),
  );
  if (!ok) {
    throw new AppError(
      "validation_failed",
      `Add a work pass valid on ${displayDate(date)} first. Foreign employees need a pass covering their start date.`,
      { target: "json", issues: [{ path: "workPass", message: "Add a work pass that covers the start date." }] },
    );
  }
}

/** Retroactive guard: a change dated on or before the last finalised period needs `retroactive: true`. */
async function assertNotFinalised(ctx: LifecycleCtx, effectiveFrom: string, retroactive: boolean | undefined, tx?: Db) {
  const end = await ctx.ports.payroll.lastFinalisedPeriodEnd(ctx.actor.orgId, tx);
  if (end && effectiveFrom <= end) {
    const [y, m] = end.split("-").map(Number) as [number, number];
    if (!retroactive) {
      throw new AppError(
        "validation_failed",
        `${displayMonth(y, m)} payroll is finalised. Set retroactive to record this change; payroll will get a back-pay adjustment.`,
        {
          target: "json",
          issues: [
            {
              path: "compensation.retroactive",
              message: `${displayMonth(y, m)} is finalised. A retroactive change will create a back-pay adjustment.`,
            },
          ],
          reason: "period_finalised",
        },
      );
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Timeline writes

async function insertEmploymentVersion(
  tx: Db,
  ctx: LifecycleCtx,
  row: Omit<typeof employmentRecords.$inferInsert, "id" | "orgId" | "effectiveTo">,
): Promise<string> {
  const existing = await tx
    .select()
    .from(employmentRecords)
    .where(ctx.actor.org.where(employmentRecords, eq(employmentRecords.employeeId, row.employeeId)));
  const plan = planInsert(existing, row.effectiveFrom);
  if (plan.close) {
    await tx
      .update(employmentRecords)
      .set({ effectiveTo: row.effectiveFrom })
      .where(eq(employmentRecords.id, plan.close.id));
  }
  const id = ctx.deps.ids.newId();
  await tx.insert(employmentRecords).values({ ...row, id, orgId: ctx.actor.orgId, effectiveTo: plan.newEffectiveTo });
  return id;
}

async function insertCompensationVersion(
  tx: Db,
  ctx: LifecycleCtx,
  employeeId: string,
  eventId: string,
  effectiveFrom: string,
  comp: CompensationInput,
  opts: { newTenure?: boolean } = {},
): Promise<{ id: string; previous: CompensationRecord | null }> {
  const existing = await tx
    .select()
    .from(compensationRecords)
    .where(ctx.actor.org.where(compensationRecords, eq(compensationRecords.employeeId, employeeId)));
  // A new tenure has no earlier pay to adjust, so the finalised-period guard does not apply.
  const retro = opts.newTenure ? false : await assertNotFinalised(ctx, effectiveFrom, comp.retroactive, tx);
  const plan = planInsert(existing, effectiveFrom);
  if (plan.close) {
    await tx
      .update(compensationRecords)
      .set({ effectiveTo: effectiveFrom })
      .where(eq(compensationRecords.id, plan.close.id));
  }
  const id = ctx.deps.ids.newId();
  await tx.insert(compensationRecords).values({
    id,
    orgId: ctx.actor.orgId,
    employeeId,
    eventId,
    effectiveFrom,
    effectiveTo: plan.newEffectiveTo,
    payBasis: comp.payBasis,
    amountCents: comp.amountCents,
    reason: comp.reason ?? null,
    retroactive: retro,
  });
  if (retro) {
    await ctx.ports.payroll.notifyBackPay(
      {
        orgId: ctx.actor.orgId,
        employeeId,
        compensationRecordId: id,
        effectiveFrom,
        previousAmountCents: plan.close?.amountCents ?? null,
        newAmountCents: comp.amountCents,
      },
      tx,
    );
  }
  return { id, previous: plan.close };
}

async function insertAllowances(
  tx: Db,
  ctx: LifecycleCtx,
  employeeId: string,
  eventId: string,
  effectiveFrom: string,
  allowances: z.output<typeof allowanceInput>[],
) {
  if (allowances.length) {
    assertCanWrite(ctx.actor, "compensation");
    assertNotSelfChange(ctx.actor, "compensation", employeeId);
  }
  for (const a of allowances) {
    const [t] = await tx
      .select({ archivedAt: allowanceTypes.archivedAt })
      .from(allowanceTypes)
      .where(ctx.actor.org.whereId(allowanceTypes, a.allowanceTypeId));
    if (!t || t.archivedAt) throw fieldError("allowances", "Choose an existing, active allowance type.");
    const existing = await tx
      .select()
      .from(recurringAllowances)
      .where(
        ctx.actor.org.where(
          recurringAllowances,
          eq(recurringAllowances.employeeId, employeeId),
          eq(recurringAllowances.allowanceTypeId, a.allowanceTypeId),
        ),
      );
    const plan = planInsert(existing, effectiveFrom);
    if (plan.close) {
      await tx
        .update(recurringAllowances)
        .set({ effectiveTo: effectiveFrom })
        .where(eq(recurringAllowances.id, plan.close.id));
    }
    await tx.insert(recurringAllowances).values({
      id: ctx.deps.ids.newId(),
      orgId: ctx.actor.orgId,
      employeeId,
      allowanceTypeId: a.allowanceTypeId,
      eventId,
      amountCents: a.amountCents,
      effectiveFrom,
      effectiveTo: plan.newEffectiveTo,
    });
  }
}

async function insertEvent(
  tx: Db,
  ctx: LifecycleCtx,
  e: { employeeId: string; tenureId: string | null; type: LifecycleEventType; effectiveDate: string; payload: object },
): Promise<string> {
  const id = ctx.deps.ids.newId();
  await tx.insert(lifecycleEvents).values({
    id,
    orgId: ctx.actor.orgId,
    employeeId: e.employeeId,
    tenureId: e.tenureId,
    type: e.type,
    effectiveDate: e.effectiveDate,
    payload: e.payload as Record<string, unknown>,
    createdBy: ctx.actor.userId,
  });
  return id;
}

async function currentTenure(tx: Db, orgId: string, employeeId: string): Promise<Tenure | null> {
  const org = orgScope(tx, orgId);
  const [t] = await tx
    .select()
    .from(tenures)
    .where(org.where(tenures, eq(tenures.employeeId, employeeId)))
    .orderBy(desc(tenures.hireDate))
    .limit(1);
  return t ?? null;
}

// ---------------------------------------------------------------------------
// Hire

export interface HireOptions {
  /** Validate everything, then roll back (import preview). */
  dryRun?: boolean;
  /** Use this transaction instead of opening one (import commit: all rows in one transaction). */
  tx?: Db;
}

export async function hire(
  ctx: LifecycleCtx,
  raw: unknown,
  opts: HireOptions = {},
): Promise<{ employeeId: string; invite: HireInvite | null }> {
  assertCanWrite(ctx.actor, "employment");
  const input = parseInput(hireInput, raw);
  // Recurring allowances are pay too (review #16): same rights as the basic salary.
  if ((input.compensation || input.allowances?.length) && !canWrite(ctx.actor, "compensation")) {
    throw new AppError(
      "forbidden",
      "Your role cannot set pay. Leave compensation empty; a payroll admin adds it after the hire.",
      { area: "compensation" },
    );
  }
  const run = async (tx: Db) => {
    const id = await hireInTx(tx, ctx, input);
    if (opts.dryRun) throw new DryRunRollback(id);
    await recordAudit(tx, ctx.ports, ctx.actor, {
      action: "employee.hired",
      targetType: "employee",
      targetId: id,
      diff: {
        ...diffOf(null, {
          legalName: input.person.legalName,
          idNumber: "set",
          hireDate: input.job.hireDate,
          jobTitle: input.job.jobTitle,
          ...(input.compensation ? { basicPayCents: input.compensation.amountCents } : {}),
        }),
        ...(input.allowances?.length ? { allowances: { changed: true as const } } : {}),
      },
    });
    return id;
  };
  try {
    const employeeId = opts.tx ? await run(opts.tx) : await ctx.deps.db.transaction(run);
    let invite: HireInvite | null = null;
    const email = input.person.workEmail;
    if (!opts.dryRun && email && input.invite !== false) {
      // After the hire commits: the invitation is a separate step and never undoes the hire.
      invite = await ctx.ports.memberships.inviteForEmployee(
        {
          orgId: ctx.actor.orgId,
          employeeId,
          email: normaliseEmail(email),
          displayName: input.person.preferredName || input.person.legalName,
        },
        ctx.actor.auditCtx,
      );
    }
    return { employeeId, invite };
  } catch (err) {
    if (err instanceof DryRunRollback) return { employeeId: err.employeeId, invite: null };
    if (isUniqueViolation(err, "employees_org_number_unique")) {
      throw fieldError("person.employeeNumber", "This employee number is already used. Leave it empty to auto-number.");
    }
    if (isUniqueViolation(err, "employees_org_id_hmac_unique")) {
      throw new AppError("duplicate_id_number", "This ID number is already used by another employee.");
    }
    throw err;
  }
}

export class DryRunRollback extends Error {
  readonly employeeId: string;
  constructor(employeeId: string) {
    super("dry run");
    this.employeeId = employeeId;
  }
}

async function hireInTx(tx: Db, ctx: LifecycleCtx, input: HireInput): Promise<string> {
  const { orgId } = ctx.actor;
  const p = input.person;
  const hireDate = input.job.hireDate;
  if (p.dob >= hireDate) throw fieldError("person.dob", "The date of birth must be before the start date.");
  // Employment Act s 68 (sg-rules): nobody under 13 on the start date. The family-only industrial
  // undertaking exception is not supported. Start dates before the encoded rules (2025) are not
  // checked: their history is not cited.
  const age = employmentAgeOn(p.dob, hireDate);
  if (age && !age.allowed) {
    throw fieldError(
      "person.dob",
      `Employees must be at least ${age.minimumAge} on their start date (Employment Act s 68). Check the date of birth.`,
    );
  }
  const id = await sealIdNumber(ctx.ports, p.idType, p.idNumber, "person.idNumber");
  await assertIdNumberFree(tx, orgId, id.hmac);
  if (p.workEmail) await assertWorkEmailFree(tx, orgId, p.workEmail, ctx.today);
  const employeeNumber = p.employeeNumber ?? (await nextEmployeeNumber(tx, orgId));
  const employeeId = ctx.deps.ids.newId();
  await tx.insert(employees).values({
    id: employeeId,
    orgId,
    employeeNumber,
    legalName: p.legalName,
    preferredName: p.preferredName ?? null,
    idType: p.idType,
    idNumberEnc: id.enc,
    idNumberHmac: id.hmac,
    idNumberMasked: id.masked,
    dob: p.dob,
    gender: p.gender ?? null,
    nationality: p.nationality ?? null,
    residencyStatus: p.residencyStatus,
    prStartDate: p.prStartDate ?? null,
    sprCpfOption: p.residencyStatus === "pr" ? (p.sprCpfOption ?? "gg") : null,
    sprCpfOptionApprovedOn: p.sprCpfOptionApprovedOn ?? null,
    race: p.race ?? null,
    raceSecondary: p.raceSecondary ?? null,
    religion: p.religion ?? null,
    shgOptOutOn: p.shgOptOutOn ?? null,
    workEmail: p.workEmail ? normaliseEmail(p.workEmail) : null,
    personalEmail: p.personalEmail ? normaliseEmail(p.personalEmail) : null,
    mobileE164: phoneOrError(p.mobile, "person.mobile"),
    address: p.address ?? null,
  });
  if (input.workPass) {
    const sealed = await sealWorkPass(ctx.ports, input.workPass.passNumber);
    await tx.insert(workPasses).values({
      id: ctx.deps.ids.newId(),
      orgId,
      employeeId,
      passType: input.workPass.passType,
      passNumberEnc: sealed.enc,
      passNumberMasked: sealed.masked,
      issuedOn: input.workPass.issuedOn ?? null,
      expiresOn: input.workPass.expiresOn,
      notes: input.workPass.notes ?? null,
    });
  }
  if (p.residencyStatus === "foreigner") await assertPassValidOn(tx, orgId, employeeId, hireDate);
  for (const [position, c] of (input.emergencyContacts ?? []).entries()) {
    await tx.insert(emergencyContacts).values({
      id: ctx.deps.ids.newId(),
      orgId,
      employeeId,
      name: c.name,
      relationship: c.relationship,
      phoneE164: phoneOrError(c.phone, `emergencyContacts.${position}.phone`) as string,
      position,
    });
  }
  await startTenure(tx, ctx, employeeId, "hire", input.job, input.compensation ?? null, input.allowances ?? []);
  return employeeId;
}

async function startTenure(
  tx: Db,
  ctx: LifecycleCtx,
  employeeId: string,
  type: "hire" | "rehire",
  job: JobFields & { hireDate: string },
  compensation: Omit<CompensationInput, "retroactive"> | null,
  allowances: z.output<typeof allowanceInput>[],
): Promise<string> {
  const { orgId } = ctx.actor;
  await validateJob(tx, orgId, employeeId, job, job.hireDate);
  const scheduleId = job.workScheduleId ?? (await defaultWorkScheduleId(tx, orgId));
  if (!scheduleId) {
    throw fieldError("job.workScheduleId", "Create a work schedule first (Settings → Structure), or choose one here.");
  }
  const tenureId = ctx.deps.ids.newId();
  await tx.insert(tenures).values({ id: tenureId, orgId, employeeId, hireDate: job.hireDate });
  const eventId = await insertEvent(tx, ctx, {
    employeeId,
    tenureId,
    type,
    effectiveDate: job.hireDate,
    payload: { jobTitle: job.jobTitle, departmentId: job.departmentId },
  });
  await insertEmploymentVersion(tx, ctx, {
    employeeId,
    tenureId,
    eventId,
    effectiveFrom: job.hireDate,
    jobTitle: job.jobTitle,
    departmentId: job.departmentId,
    teamId: job.teamId ?? null,
    locationId: job.locationId ?? null,
    costCentreId: job.costCentreId ?? null,
    managerEmployeeId: job.managerEmployeeId ?? null,
    employmentType: job.employmentType,
    workScheduleId: scheduleId,
    probationEnd: job.probationEnd ?? null,
    eaCovered: job.eaCovered ?? true,
    isWorkman: job.isWorkman ?? false,
  });
  if (compensation) {
    await insertCompensationVersion(tx, ctx, employeeId, eventId, job.hireDate, compensation, { newTenure: true });
  }
  if (allowances.length) await insertAllowances(tx, ctx, employeeId, eventId, job.hireDate, allowances);
  await instantiateChecklist(tx, ctx.deps.ids, {
    orgId,
    employeeId,
    eventId,
    kind: "onboarding",
    anchorDate: job.hireDate,
  });
  return eventId;
}

// ---------------------------------------------------------------------------
// Other events

const changeEvent = z.object({
  type: z.enum(["transfer", "promotion"]),
  effectiveDate: isoDate,
  changes: jobFields.partial(),
  compensation: compensationInput.nullish(),
  allowances: z.array(allowanceInput).max(20).optional(),
  note: z.string().trim().max(500).nullish(),
});
const salaryEvent = z.object({
  type: z.literal("salary_change"),
  effectiveDate: isoDate,
  compensation: compensationInput.nullish(),
  allowances: z.array(allowanceInput).max(20).optional(),
  note: z.string().trim().max(500).nullish(),
});
const probationEvent = z.object({ type: z.literal("probation_confirmed"), effectiveDate: isoDate });
const resignationEvent = z.object({
  type: z.literal("resignation"),
  noticeGivenOn: isoDate,
  /**
   * The contractual notice period in days. Omit it when the contract states none: the Employment
   * Act minimum for the length of service applies (1 day, 1 week, 2 weeks or 4 weeks; sg-rules).
   */
  noticeDays: z.number().int().min(0).max(365).nullish(),
  /** Earlier last day agreed with the employee (shortened notice). */
  agreedLastWorkingDay: isoDate.nullish(),
  note: z.string().trim().max(500).nullish(),
});
const terminationEvent = z.object({
  type: z.literal("termination"),
  reason: z.enum(TERMINATION_REASONS),
  lastWorkingDay: isoDate,
  noticeGivenOn: isoDate.nullish(),
  note: z.string().trim().max(500).nullish(),
});
const rehireEvent = z.object({
  type: z.literal("rehire"),
  job: jobFields.extend({ hireDate: isoDate }),
  compensation: compensationInput.omit({ retroactive: true }).nullish(),
  allowances: z.array(allowanceInput).max(20).optional(),
});

export const eventInput = z.discriminatedUnion("type", [
  changeEvent,
  salaryEvent,
  probationEvent,
  resignationEvent,
  terminationEvent,
  rehireEvent,
]);
export type EventInput = z.output<typeof eventInput>;

function employmentAgeOn(dob: string, onDate: string) {
  try {
    return checkEmploymentAge({ dob, onDate });
  } catch (err) {
    if (err instanceof RulesNotAvailableError) return null;
    throw err;
  }
}

/**
 * Employment Act minimum notice when the contract states none, by service from the start of this
 * tenure to the notice date (sg-rules `statutoryMinimumNotice`, MOM "Termination with notice").
 */
function statutoryNoticeDays(serviceStart: string, noticeGivenOn: string): number {
  try {
    return statutoryMinimumNotice({ serviceStart, noticeGivenOn }).noticeDays;
  } catch (err) {
    if (err instanceof RulesNotAvailableError) {
      throw fieldError(
        "noticeDays",
        "Enter the notice period from the contract: no statutory default is encoded for that date.",
      );
    }
    throw err;
  }
}

/** Last working day, counting the notice date as day 1 (3 Nov + 30 days → 2 Dec). */
export function lastWorkingDayFor(noticeGivenOn: string, noticeDays: number): string {
  return addDays(noticeGivenOn, Math.max(noticeDays, 1) - 1);
}

export async function applyEvent(
  ctx: LifecycleCtx,
  employeeId: string,
  raw: unknown,
): Promise<{ eventId: string; status: EventStatus }> {
  const input = parseInput(eventInput, raw);
  const touchesPay =
    input.type === "salary_change" ||
    ("compensation" in input && !!input.compensation) ||
    ("allowances" in input && (input.allowances?.length ?? 0) > 0);
  const touchesJob =
    input.type === "transfer" || input.type === "promotion"
      ? Object.keys(input.changes).length > 0
      : input.type !== "salary_change";
  if (touchesPay) {
    assertCanWrite(ctx.actor, "compensation");
    assertNotSelfChange(ctx.actor, "compensation", employeeId);
  }
  if (touchesJob || !touchesPay) assertCanWrite(ctx.actor, "employment");
  const apply = async (tx: Db): Promise<ApplyResult> => {
    await lockEmployee(tx, ctx.actor.orgId, employeeId);
    switch (input.type) {
      case "transfer":
      case "promotion":
      case "salary_change":
      case "probation_confirmed":
        return applyChange(tx, ctx, employeeId, input);
      case "resignation":
      case "termination":
        return applyLeaving(tx, ctx, employeeId, input);
      case "rehire":
        return applyRehire(tx, ctx, employeeId, input);
    }
  };
  const { eventId, effectiveDate } = await ctx.deps.db.transaction(async (tx) => {
    const result = await apply(tx);
    // Workflows: open manager approval tasks follow a new line manager (same transaction).
    if ((input.type === "transfer" || input.type === "promotion") && "managerEmployeeId" in input.changes) {
      await onReportingLineChanged(tx, ctx.deps, ctx.actor.auditCtx, { orgId: ctx.actor.orgId, employeeId });
    }
    await recordAudit(tx, ctx.ports, ctx.actor, {
      action: `lifecycle.${input.type}`,
      targetType: "employee",
      targetId: employeeId,
      diff: result.audit,
      meta: { eventId: result.eventId, effectiveDate: result.effectiveDate },
    });
    return result;
  });
  return { eventId, status: eventStatus({ effectiveDate, cancelledAt: null }, ctx.today) };
}

type ApplyResult = {
  eventId: string;
  effectiveDate: string;
  audit: Record<string, { from?: unknown; to?: unknown; changed?: true }>;
};

async function applyChange(
  tx: Db,
  ctx: LifecycleCtx,
  employeeId: string,
  input: z.output<typeof changeEvent> | z.output<typeof salaryEvent> | z.output<typeof probationEvent>,
): Promise<ApplyResult> {
  const { orgId } = ctx.actor;
  const { org } = ctx.actor;
  const date = input.effectiveDate;
  const records = await tx
    .select()
    .from(employmentRecords)
    .where(org.where(employmentRecords, eq(employmentRecords.employeeId, employeeId)));
  const base = findAsAt(records, date);
  if (!base) {
    throw fieldError(
      "effectiveDate",
      `The employee has no employment record on ${displayDate(date)}. Pick a date within their employment.`,
    );
  }
  const changes: Partial<JobFields> =
    input.type === "transfer" || input.type === "promotion"
      ? input.changes
      : input.type === "probation_confirmed"
        ? { probationEnd: date }
        : {};
  const comp = "compensation" in input ? input.compensation : null;
  const allowances = "allowances" in input ? (input.allowances ?? []) : [];
  if (Object.keys(changes).length === 0 && !comp && allowances.length === 0) {
    throw new AppError("validation_failed", "Nothing to change. Add at least one new value.", {
      target: "json",
      issues: [{ path: "changes", message: "Change at least one field, or the pay." }],
    });
  }
  const eventId = await insertEvent(tx, ctx, {
    employeeId,
    tenureId: base.tenureId,
    type: input.type,
    effectiveDate: date,
    payload: { changes, note: "note" in input ? (input.note ?? null) : null },
  });
  const audit: ApplyResult["audit"] = {};
  if (Object.keys(changes).length) {
    await validateJob(tx, orgId, employeeId, changes, date);
    const { id: _id, orgId: _o, effectiveTo: _t, createdAt: _c, ...copy } = base;
    const next = { ...copy, ...stripUndefined(changes), eventId, effectiveFrom: date } as EmploymentRecord;
    await insertEmploymentVersion(tx, ctx, next);
    Object.assign(audit, diffOf(base as unknown as Record<string, unknown>, stripUndefined(changes)));
  }
  if (comp) {
    const { previous } = await insertCompensationVersion(tx, ctx, employeeId, eventId, date, comp);
    if (previous?.amountCents !== comp.amountCents) audit.basicPayCents = { changed: true };
  }
  if (allowances.length) {
    await insertAllowances(tx, ctx, employeeId, eventId, date, allowances);
    audit.allowances = { changed: true };
  }
  return { eventId, effectiveDate: date, audit };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function applyLeaving(
  tx: Db,
  ctx: LifecycleCtx,
  employeeId: string,
  input: z.output<typeof resignationEvent> | z.output<typeof terminationEvent>,
): Promise<ApplyResult> {
  const { orgId, org } = ctx.actor;
  const tenure = await currentTenure(tx, orgId, employeeId);
  if (!tenure) throw new AppError("conflict", "This person has no employment to end.");
  await assertMayEndEmployment(tx, ctx, employeeId);
  if (tenure.lastWorkingDay) {
    throw new AppError(
      "conflict",
      `A last working day (${displayDate(tenure.lastWorkingDay)}) is already set. Cancel that event first to change it.`,
      { reason: "already_leaving" },
    );
  }
  let lastDay: string;
  let noticeGivenOn: string | null = null;
  let noticeDays: number | null = null;
  let noticeBasis: "contract" | "statutory" | null = null;
  let computed: string | null = null;
  if (input.type === "resignation") {
    noticeGivenOn = input.noticeGivenOn;
    if (input.noticeGivenOn < tenure.hireDate) {
      throw fieldError("noticeGivenOn", "Notice cannot be given before the start date.");
    }
    noticeBasis = input.noticeDays == null ? "statutory" : "contract";
    noticeDays = input.noticeDays ?? statutoryNoticeDays(tenure.hireDate, input.noticeGivenOn);
    computed = lastWorkingDayFor(input.noticeGivenOn, noticeDays);
    if (input.agreedLastWorkingDay && input.agreedLastWorkingDay > computed) {
      throw fieldError("agreedLastWorkingDay", "An agreed last day can shorten the notice period, not extend it.");
    }
    if (input.agreedLastWorkingDay && input.agreedLastWorkingDay < input.noticeGivenOn) {
      throw fieldError("agreedLastWorkingDay", "The last day cannot be before the notice date.");
    }
    lastDay = input.agreedLastWorkingDay ?? computed;
  } else {
    lastDay = input.lastWorkingDay;
    noticeGivenOn = input.noticeGivenOn ?? null;
  }
  if (lastDay < tenure.hireDate)
    throw fieldError("lastWorkingDay", "The last working day cannot be before the start date.");
  const endExclusive = addDays(lastDay, 1);

  // Changes scheduled after the last day must be cancelled first.
  const [later] = await tx
    .select({ effectiveDate: lifecycleEvents.effectiveDate, type: lifecycleEvents.type })
    .from(lifecycleEvents)
    .where(
      org.where(
        lifecycleEvents,
        eq(lifecycleEvents.employeeId, employeeId),
        eq(lifecycleEvents.tenureId, tenure.id),
        gt(lifecycleEvents.effectiveDate, lastDay),
        isNull(lifecycleEvents.cancelledAt),
      ),
    );
  if (later) {
    throw new AppError(
      "conflict",
      `A ${later.type.replace("_", " ")} is scheduled for ${displayDate(later.effectiveDate)}, after the last day. Cancel it first.`,
      { reason: "scheduled_after_last_day" },
    );
  }
  const eventId = await insertEvent(tx, ctx, {
    employeeId,
    tenureId: tenure.id,
    type: input.type,
    effectiveDate: lastDay,
    payload: {
      noticeGivenOn,
      noticeDays,
      noticeBasis,
      reason: input.type === "termination" ? input.reason : "resignation",
      note: input.note ?? null,
      computedLastWorkingDay: computed,
    },
  });
  const closed = await closeOpenRecords(tx, orgId, employeeId, endExclusive);
  await tx
    .update(lifecycleEvents)
    .set({ payload: { ...(await eventPayload(tx, eventId)), closed } })
    .where(eq(lifecycleEvents.id, eventId));
  await tx
    .update(tenures)
    .set({
      lastWorkingDay: lastDay,
      noticeGivenOn,
      noticeDays,
      cessationReason: input.type === "termination" ? input.reason : "resignation",
      cessationEventId: eventId,
      updatedAt: ctx.deps.clock.now(),
    })
    .where(eq(tenures.id, tenure.id));
  await instantiateChecklist(tx, ctx.deps.ids, {
    orgId,
    employeeId,
    eventId,
    kind: "offboarding",
    anchorDate: lastDay,
  });
  return { eventId, effectiveDate: lastDay, audit: { lastWorkingDay: { from: null, to: lastDay } } };
}

/**
 * Ending the employment of someone whose sign-in holds roles takes those roles away when it takes
 * effect, so only an owner may record it (review #6), and never for the last active owner: the
 * sweep could not make them former, and the organisation would lose its owner (review #7).
 */
async function assertMayEndEmployment(tx: Db, ctx: LifecycleCtx, employeeId: string) {
  const { orgId } = ctx.actor;
  const linked = await tx
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(
      and(
        orgScope(tx, orgId).where(memberships, eq(memberships.employeeId, employeeId)),
        inArray(memberships.status, ["active", "invited", "suspended"]),
      ),
    );
  if (!linked.length) return;
  const held = await tx
    .select({ membershipId: membershipRoles.membershipId, role: membershipRoles.role })
    .from(membershipRoles)
    .where(
      and(
        orgScope(tx, orgId).where(membershipRoles),
        inArray(
          membershipRoles.membershipId,
          linked.map((m) => m.id),
        ),
      ),
    );
  if (!held.length) return;
  if (!ctx.actor.roles.has("owner")) {
    throw new AppError(
      "forbidden",
      "Only an owner can record the resignation or termination of someone who holds the owner, HR admin or payroll admin role.",
      { reason: "holds_roles" },
    );
  }
  const activeIds = new Set(linked.filter((m) => m.status === "active").map((m) => m.id));
  if (!held.some((r) => r.role === "owner" && activeIds.has(r.membershipId))) return;
  const owners = await tx
    .select({ id: memberships.id })
    .from(membershipRoles)
    .innerJoin(
      memberships,
      and(eq(memberships.id, membershipRoles.membershipId), eq(memberships.orgId, membershipRoles.orgId)),
    )
    .where(
      orgScope(tx, orgId).where(membershipRoles, eq(membershipRoles.role, "owner"), eq(memberships.status, "active")),
    );
  if (!owners.some((o) => !activeIds.has(o.id))) {
    throw new AppError(
      "last_owner",
      "This person is the only active owner. Make someone else an owner (Settings → Members) before recording their last day.",
    );
  }
}

async function eventPayload(tx: Db, eventId: string): Promise<Record<string, unknown>> {
  const [e] = await tx
    .select({ payload: lifecycleEvents.payload })
    .from(lifecycleEvents)
    .where(eq(lifecycleEvents.id, eventId));
  return e?.payload ?? {};
}

/** Ends open-ended employment, compensation and allowance rows at `endExclusive`; returns their ids for undo. */
async function closeOpenRecords(tx: Db, orgId: string, employeeId: string, endExclusive: string) {
  const org = orgScope(tx, orgId);
  const closed = { employment: [] as string[], compensation: [] as string[], allowances: [] as string[] };
  const tables = [
    ["employment", employmentRecords],
    ["compensation", compensationRecords],
    ["allowances", recurringAllowances],
  ] as const;
  for (const [key, table] of tables) {
    const rows = await tx
      .update(table)
      .set({ effectiveTo: endExclusive })
      .where(org.where(table, eq(table.employeeId, employeeId), isNull(table.effectiveTo)))
      .returning({ id: table.id });
    closed[key].push(...rows.map((r) => r.id));
  }
  return closed;
}

async function applyRehire(
  tx: Db,
  ctx: LifecycleCtx,
  employeeId: string,
  input: z.output<typeof rehireEvent>,
): Promise<ApplyResult> {
  const { orgId } = ctx.actor;
  const { org } = ctx.actor;
  const previous = await currentTenure(tx, orgId, employeeId);
  if (!previous?.lastWorkingDay || previous.lastWorkingDay >= input.job.hireDate) {
    throw new AppError(
      "conflict",
      previous?.lastWorkingDay
        ? `The new start date must be after the previous last day (${displayDate(previous.lastWorkingDay)}).`
        : "This person is still employed. Record their resignation or termination before rehiring.",
      { reason: "not_former" },
    );
  }
  if ((input.compensation || input.allowances?.length) && !canWrite(ctx.actor, "compensation")) {
    throw new AppError(
      "forbidden",
      "Your role cannot set pay. Leave compensation and allowances empty; a payroll admin adds them later.",
    );
  }
  const [emp] = await tx.select().from(employees).where(org.whereId(employees, employeeId));
  if (emp?.residencyStatus === "foreigner") await assertPassValidOn(tx, orgId, employeeId, input.job.hireDate);
  const eventId = await startTenure(
    tx,
    ctx,
    employeeId,
    "rehire",
    input.job,
    input.compensation ?? null,
    input.allowances ?? [],
  );
  return {
    eventId,
    effectiveDate: input.job.hireDate,
    audit: {
      hireDate: { from: null, to: input.job.hireDate },
      ...(input.compensation ? { basicPayCents: { changed: true as const } } : {}),
      ...(input.allowances?.length ? { allowances: { changed: true as const } } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Cancel

export async function cancelEvent(ctx: LifecycleCtx, employeeId: string, eventId: string): Promise<void> {
  const { orgId } = ctx.actor;
  const { org } = ctx.actor;
  await ctx.deps.db.transaction(async (tx) => {
    await lockEmployee(tx, orgId, employeeId);
    const [e] = await tx
      .select()
      .from(lifecycleEvents)
      .where(org.where(lifecycleEvents, eq(lifecycleEvents.employeeId, employeeId), eq(lifecycleEvents.id, eventId)));
    if (!e) throw new AppError("not_found", "No such event.");
    // Pay is basic salary and recurring allowances (review #17): undoing either is a pay change.
    const touchesPay =
      e.type === "salary_change" ||
      (
        await tx
          .select({ id: compensationRecords.id })
          .from(compensationRecords)
          .where(org.where(compensationRecords, eq(compensationRecords.eventId, eventId)))
      ).length > 0 ||
      (
        await tx
          .select({ id: recurringAllowances.id })
          .from(recurringAllowances)
          .where(org.where(recurringAllowances, eq(recurringAllowances.eventId, eventId)))
      ).length > 0;
    if (touchesPay) {
      assertCanWrite(ctx.actor, "compensation");
      assertNotSelfChange(ctx.actor, "compensation", employeeId);
    }
    const [jobVersion] = await tx
      .select({ id: employmentRecords.id })
      .from(employmentRecords)
      .where(org.where(employmentRecords, eq(employmentRecords.eventId, eventId)))
      .limit(1);
    // A combined event needs both permissions: cancelling pay must not also undo a job change.
    if (!touchesPay || jobVersion) assertCanWrite(ctx.actor, "employment");
    if (eventStatus(e, ctx.today) !== "scheduled") {
      throw new AppError(
        "conflict",
        e.cancelledAt
          ? "This event is already cancelled."
          : "Only scheduled events can be cancelled. Correct an effective event with a new event.",
        { reason: "not_scheduled" },
      );
    }
    if (e.type === "hire" || e.type === "rehire") {
      throw new AppError("conflict", "A scheduled hire cannot be cancelled yet. Record a termination instead.", {
        reason: "not_supported",
      });
    }
    if (e.type === "resignation" || e.type === "termination") {
      const closed = (e.payload.closed ?? { employment: [], compensation: [], allowances: [] }) as Record<
        "employment" | "compensation" | "allowances",
        string[]
      >;
      if (closed.employment.length)
        await tx
          .update(employmentRecords)
          .set({ effectiveTo: null })
          .where(inArray(employmentRecords.id, closed.employment));
      if (closed.compensation.length)
        await tx
          .update(compensationRecords)
          .set({ effectiveTo: null })
          .where(inArray(compensationRecords.id, closed.compensation));
      if (closed.allowances.length)
        await tx
          .update(recurringAllowances)
          .set({ effectiveTo: null })
          .where(inArray(recurringAllowances.id, closed.allowances));
      await tx
        .update(tenures)
        .set({
          lastWorkingDay: null,
          noticeGivenOn: null,
          noticeDays: null,
          cessationReason: null,
          cessationEventId: null,
        })
        .where(org.where(tenures, eq(tenures.cessationEventId, eventId)));
    } else {
      await removeEventVersions(tx, orgId, employeeId, eventId);
    }
    await cancelChecklistsForEvent(tx, orgId, eventId);
    // Workflows: a cancelled transfer may restore the previous line manager.
    if (e.type === "transfer" || e.type === "promotion") {
      await onReportingLineChanged(tx, ctx.deps, ctx.actor.auditCtx, { orgId, employeeId });
    }
    await tx
      .update(lifecycleEvents)
      .set({ cancelledAt: ctx.deps.clock.now(), cancelledBy: ctx.actor.userId })
      .where(eq(lifecycleEvents.id, eventId));
    await recordAudit(tx, ctx.ports, ctx.actor, {
      action: "lifecycle.cancelled",
      targetType: "employee",
      targetId: employeeId,
      meta: { eventId, type: e.type, touchesPay },
    });
  });
}

/** Deletes the versions an event created and re-opens each predecessor (it ended where the removed one began). */
async function removeEventVersions(tx: Db, orgId: string, employeeId: string, eventId: string) {
  const org = orgScope(tx, orgId);
  const emp = await tx
    .delete(employmentRecords)
    .where(org.where(employmentRecords, eq(employmentRecords.eventId, eventId)))
    .returning();
  for (const r of emp) {
    await tx
      .update(employmentRecords)
      .set({ effectiveTo: r.effectiveTo })
      .where(
        org.where(
          employmentRecords,
          eq(employmentRecords.employeeId, employeeId),
          eq(employmentRecords.effectiveTo, r.effectiveFrom),
        ),
      );
  }
  const comp = await tx
    .delete(compensationRecords)
    .where(org.where(compensationRecords, eq(compensationRecords.eventId, eventId)))
    .returning();
  for (const r of comp) {
    await tx
      .update(compensationRecords)
      .set({ effectiveTo: r.effectiveTo })
      .where(
        org.where(
          compensationRecords,
          eq(compensationRecords.employeeId, employeeId),
          eq(compensationRecords.effectiveTo, r.effectiveFrom),
        ),
      );
  }
  const allw = await tx
    .delete(recurringAllowances)
    .where(org.where(recurringAllowances, eq(recurringAllowances.eventId, eventId)))
    .returning();
  for (const r of allw) {
    await tx
      .update(recurringAllowances)
      .set({ effectiveTo: r.effectiveTo })
      .where(
        org.where(
          recurringAllowances,
          eq(recurringAllowances.employeeId, employeeId),
          eq(recurringAllowances.allowanceTypeId, r.allowanceTypeId),
          eq(recurringAllowances.effectiveTo, r.effectiveFrom),
        ),
      );
  }
}

/** Events of one employee, newest first, with derived status. */
export async function listEvents(db: Db, orgId: string, employeeId: string, today: string) {
  const org = orgScope(db, orgId);
  const rows = await db
    .select()
    .from(lifecycleEvents)
    .where(org.where(lifecycleEvents, eq(lifecycleEvents.employeeId, employeeId)))
    .orderBy(desc(lifecycleEvents.effectiveDate), desc(lifecycleEvents.createdAt));
  return rows.map((e) => ({
    id: e.id,
    type: e.type,
    effectiveDate: e.effectiveDate,
    status: eventStatus(e, today),
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function tenuresOf(db: Db, orgId: string, employeeId: string) {
  const org = orgScope(db, orgId);
  return db
    .select()
    .from(tenures)
    .where(org.where(tenures, eq(tenures.employeeId, employeeId)))
    .orderBy(asc(tenures.hireDate));
}
