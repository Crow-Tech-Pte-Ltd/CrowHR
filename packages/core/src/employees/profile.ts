import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { memberships } from "../db/schema/access.ts";
import { allowanceTypes, bankAccounts, type Employee, emergencyContacts, employees } from "../db/schema/employees.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { CONTROL_CHARS } from "../export/csv.ts";
import { notify } from "../notifications/notify.ts";
import { type Actor, assertCanRead, assertCanWrite, assertNotSelfChange } from "./access.ts";
import { diffOf, recordAudit } from "./audit-helpers.ts";
import { normaliseAccountNumber } from "./banks.ts";
import { normaliseEmail } from "./contact.ts";
import { singaporeToday } from "./dates.ts";
import { asAt, planInsert } from "./effective.ts";
import { maskTail } from "./nric.ts";
import { assertIdNumberFree, assertWorkEmailFree, phoneOrError, sealIdNumber } from "./person.ts";
import type { PeoplePorts } from "./ports.ts";
import { addressInput, bankAccountInput, emergencyContactsInput, personPatch, refinePerson } from "./schemas.ts";
import { fieldError, isUniqueViolation, parseInput } from "./validation.ts";

async function loadEmployee(db: Db, orgId: string, employeeId: string): Promise<Employee> {
  return orgScope(db, orgId).getById(employees, employeeId, "employee record");
}

/** Fields an admin edits on the profile (personal and identity). Employment changes go through events. */
export const adminProfilePatch = personPatch.omit({ employeeNumber: true });

/**
 * Applies a validated personal-details patch. Used by HR edits and by
 * approved change requests (`actor` is then the approver).
 */
export async function applyPersonalPatch(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  employeeId: string,
  raw: unknown,
  opts: { action?: string } = {},
): Promise<void> {
  const patch = parseInput(adminProfilePatch, raw);
  const before = await loadEmployee(deps.db, actor.orgId, employeeId);
  const issues: { path: string; message: string }[] = [];
  const ctx = {
    addIssue: (i: { path?: (string | number)[]; message?: string }) =>
      issues.push({ path: (i.path ?? []).join("."), message: i.message ?? "Invalid." }),
  } as unknown as z.RefinementCtx;
  refinePerson(
    {
      ...patch,
      idType: patch.idType ?? before.idType,
      residencyStatus: patch.residencyStatus ?? before.residencyStatus,
    },
    ctx,
    { residencyStatus: before.residencyStatus, prStartDate: before.prStartDate },
  );
  if (issues.length) {
    throw new AppError("validation_failed", issues[0]?.message ?? "Some fields need attention.", {
      target: "json",
      issues,
    });
  }
  const today = singaporeToday(deps.clock.now());
  const set: Partial<Employee> = { updatedAt: deps.clock.now() };
  const visible: Record<string, unknown> = {};
  const copy = <K extends keyof Employee>(key: K, value: Employee[K] | undefined) => {
    if (value === undefined) return;
    set[key] = value;
    visible[key] = value;
  };
  copy("legalName", patch.legalName);
  copy("preferredName", patch.preferredName);
  copy("dob", patch.dob);
  copy("gender", patch.gender);
  copy("nationality", patch.nationality);
  copy("residencyStatus", patch.residencyStatus);
  if (patch.residencyStatus && patch.residencyStatus !== "pr") {
    set.prStartDate = null;
    set.sprCpfOption = null;
  }
  copy("prStartDate", patch.prStartDate);
  copy("sprCpfOption", patch.sprCpfOption);
  copy("sprCpfOptionApprovedOn", patch.sprCpfOptionApprovedOn);
  copy("race", patch.race);
  copy("raceSecondary", patch.raceSecondary);
  copy("religion", patch.religion);
  copy("shgOptOutOn", patch.shgOptOutOn);
  copy("personalEmail", patch.personalEmail ? normaliseEmail(patch.personalEmail) : patch.personalEmail);
  if (patch.workEmail !== undefined) {
    if (patch.workEmail) await assertWorkEmailFree(deps.db, actor.orgId, patch.workEmail, today, employeeId);
    copy("workEmail", patch.workEmail ? normaliseEmail(patch.workEmail) : null);
  }
  if (patch.mobile !== undefined) copy("mobileE164", phoneOrError(patch.mobile, "mobile"));
  copy("address", patch.address);
  if (patch.idNumber !== undefined || patch.idType !== undefined) {
    const idType = patch.idType ?? before.idType;
    const raw = patch.idNumber ?? (await ports.secretBox.decrypt("nric", before.idNumberEnc));
    const sealed = await sealIdNumber(ports, idType, raw);
    await assertIdNumberFree(deps.db, actor.orgId, sealed.hmac, employeeId);
    set.idType = idType;
    set.idNumberEnc = sealed.enc;
    set.idNumberHmac = sealed.hmac;
    set.idNumberMasked = sealed.masked;
    visible.idType = idType;
    if (sealed.hmac !== before.idNumberHmac) visible.idNumber = "changed";
  }
  const beforeView = { ...(before as unknown as Record<string, unknown>), idNumber: "unchanged" };
  await deps.db.transaction(async (tx) => {
    await tx
      .update(employees)
      .set(set)
      .where(actor.org.whereId(employees, employeeId))
      .catch((err: unknown) => {
        if (isUniqueViolation(err))
          throw new AppError("duplicate_id_number", "This ID number is already used by another employee.");
        throw err;
      });
    await recordAudit(tx, ports, actor, {
      action: opts.action ?? "employee.updated",
      targetType: "employee",
      targetId: employeeId,
      diff: diffOf(beforeView, visible),
    });
  });
}

/** HR edit of personal details (owner, hr_admin). */
export async function updatePersonal(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  employeeId: string,
  raw: unknown,
) {
  assertCanWrite(actor, "personal");
  await loadEmployee(deps.db, actor.orgId, employeeId);
  await applyPersonalPatch(deps, ports, actor, employeeId, raw);
}

async function writeEmergencyContacts(
  tx: Db,
  deps: AppDeps,
  orgId: string,
  employeeId: string,
  contacts: z.output<typeof emergencyContactsInput>,
) {
  const org = orgScope(tx, orgId);
  await tx.delete(emergencyContacts).where(org.where(emergencyContacts, eq(emergencyContacts.employeeId, employeeId)));
  for (const [position, c] of contacts.entries()) {
    await tx.insert(emergencyContacts).values({
      id: deps.ids.newId(),
      orgId,
      employeeId,
      name: c.name,
      relationship: c.relationship,
      phoneE164: phoneOrError(c.phone, `emergencyContacts.${position}.phone`) as string,
      position,
    });
  }
}

/** Replaces the emergency contacts (at most 3). HR, or the employee themself. */
export async function replaceEmergencyContacts(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  employeeId: string,
  raw: unknown,
) {
  if (actor.employeeId !== employeeId) assertCanWrite(actor, "emergency");
  await loadEmployee(deps.db, actor.orgId, employeeId);
  const contacts = parseInput(emergencyContactsInput, raw);
  await deps.db.transaction(async (tx) => {
    await writeEmergencyContacts(tx, deps, actor.orgId, employeeId, contacts);
    await recordAudit(tx, ports, actor, {
      action: "employee.emergency_contacts_updated",
      targetType: "employee",
      targetId: employeeId,
      meta: { count: contacts.length },
    });
  });
}

/** Fields employees edit directly (spec: Employee self-service changes). */
export const selfServicePatch = z
  .object({
    preferredName: z.preprocess(
      (v) => (v === "" ? null : v),
      z
        .string()
        .refine((v) => !CONTROL_CHARS.test(v), "Remove control characters from the name.")
        .trim()
        .max(100)
        .nullish(),
    ),
    personalEmail: z.preprocess((v) => (v === "" ? null : v), z.email().nullish()),
    mobile: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(30).nullish()),
    address: addressInput.nullish(),
    emergencyContacts: emergencyContactsInput.optional(),
  })
  .strict();

export async function updateOwnProfile(deps: AppDeps, ports: PeoplePorts, actor: Actor, raw: unknown) {
  if (!actor.employeeId) throw new AppError("not_found", "Your account is not linked to an employee record.");
  const employeeId = actor.employeeId;
  const patch = parseInput(selfServicePatch, raw);
  const before = await loadEmployee(deps.db, actor.orgId, employeeId);
  const set: Partial<Employee> = { updatedAt: deps.clock.now() };
  if (patch.preferredName !== undefined) set.preferredName = patch.preferredName ?? null;
  if (patch.personalEmail !== undefined)
    set.personalEmail = patch.personalEmail ? normaliseEmail(patch.personalEmail) : null;
  if (patch.mobile !== undefined) set.mobileE164 = phoneOrError(patch.mobile, "mobile");
  if (patch.address !== undefined) set.address = patch.address ?? null;
  await deps.db.transaction(async (tx) => {
    await tx.update(employees).set(set).where(actor.org.whereId(employees, employeeId));
    if (patch.emergencyContacts)
      await writeEmergencyContacts(tx, deps, actor.orgId, employeeId, patch.emergencyContacts);
    const { updatedAt: _u, ...visible } = set;
    await recordAudit(tx, ports, actor, {
      action: "employee.self_updated",
      targetType: "employee",
      targetId: employeeId,
      diff: {
        ...diffOf(before as unknown as Record<string, unknown>, visible as Record<string, unknown>),
        ...(patch.emergencyContacts ? { emergencyContacts: { changed: true as const } } : {}),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Bank accounts

async function sealAccount(ports: PeoplePorts, raw: string) {
  const digits = normaliseAccountNumber(raw);
  if (!digits) throw fieldError("accountNumber", "Enter the account number using digits only (6 to 17 digits).");
  const [enc, hmac] = await Promise.all([
    ports.secretBox.encrypt("bank-account", digits),
    ports.secretBox.blindIndex("bank-account", digits),
  ]);
  return { enc, hmac, last4: digits.slice(-4) };
}

/**
 * Records a new bank account from `effectiveFrom`; the previous one stays as
 * history and stops being current that day (spec: Bank details).
 */
export async function setBankAccount(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  employeeId: string,
  raw: unknown,
  opts: { viaChangeRequest?: boolean } = {},
) {
  if (!opts.viaChangeRequest) {
    assertCanWrite(actor, "bank");
    assertNotSelfChange(actor, "bank", employeeId);
  }
  await loadEmployee(deps.db, actor.orgId, employeeId);
  const input = parseInput(bankAccountInput, raw);
  const sealed = await sealAccount(ports, input.accountNumber);
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).for("update");
    const existing = await tx
      .select()
      .from(bankAccounts)
      .where(actor.org.where(bankAccounts, eq(bankAccounts.employeeId, employeeId)));
    const plan = planInsert(existing, input.effectiveFrom);
    if (plan.close) {
      await tx.update(bankAccounts).set({ effectiveTo: input.effectiveFrom }).where(eq(bankAccounts.id, plan.close.id));
    }
    await tx.insert(bankAccounts).values({
      id,
      orgId: actor.orgId,
      employeeId,
      bankCode: input.bankCode,
      accountNumberEnc: sealed.enc,
      accountNumberHmac: sealed.hmac,
      accountLast4: sealed.last4,
      holderName: input.holderName,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: plan.newEffectiveTo,
    });
    await recordAudit(tx, ports, actor, {
      action: "bank_account.updated",
      targetType: "employee",
      targetId: employeeId,
      diff: { bankCode: { to: input.bankCode }, accountNumber: { changed: true }, holderName: { changed: true } },
      meta: { effectiveFrom: input.effectiveFrom },
    });
    await notifyBankChange(tx, deps, actor.orgId, employeeId, sealed.last4, input.effectiveFrom);
  });
  return { id, accountMasked: maskTail(sealed.last4) };
}

/**
 * Tells the employee their salary account changed (review finding #10: an admin could redirect pay
 * unnoticed). Security category: always emailed when a mailer is configured.
 */
async function notifyBankChange(
  tx: Db,
  deps: AppDeps,
  orgId: string,
  employeeId: string,
  last4: string,
  effectiveFrom: string,
) {
  const members = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.employeeId, employeeId), eq(memberships.status, "active")));
  if (!members.length) return;
  const detail = `Salary will be paid into the account ending ${last4} from ${effectiveFrom}. If you did not ask for this, tell your employer's owner or HR straight away.`;
  await notify(tx, deps, {
    orgId,
    recipients: members.map((m) => m.id),
    kind: "security_notice",
    title: "Your bank account for salary was changed",
    body: detail,
    link: "/me/profile",
    subjectType: "employee",
    subjectId: employeeId,
    email: {
      headline: "Your bank account for salary was changed.",
      detail,
      linkPath: "/me/profile",
      actionLabel: "Check your details",
    },
  });
}

/**
 * For payroll: the account current on the payment date, decrypted. Payroll
 * must hold `bank_details:read` (checked by the caller's route).
 */
export async function bankAccountForPayment(
  deps: AppDeps,
  ports: PeoplePorts,
  orgId: string,
  employeeId: string,
  paymentDate: string,
): Promise<{ bankCode: string; accountNumber: string; holderName: string } | null> {
  const row = await asAt(deps.db, bankAccounts, orgId, employeeId, paymentDate);
  if (!row) return null;
  return {
    bankCode: row.bankCode,
    accountNumber: await ports.secretBox.decrypt("bank-account", row.accountNumberEnc),
    holderName: row.holderName,
  };
}

// ---------------------------------------------------------------------------
// Allowance types (payroll adds CPF/tax treatment columns later)

export const allowanceTypeInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter a short code, like TRANSPORT.")
    .max(30)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, "Enter a name, like Transport allowance.").max(80),
});

export async function listAllowanceTypes(deps: AppDeps, actor: Actor) {
  const rows = await deps.db
    .select()
    .from(allowanceTypes)
    .where(actor.org.where(allowanceTypes))
    .orderBy(asc(allowanceTypes.name));
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, archived: r.archivedAt !== null }));
}

export async function createAllowanceType(deps: AppDeps, ports: PeoplePorts, actor: Actor, raw: unknown) {
  assertCanWrite(actor, "compensation");
  const input = parseInput(allowanceTypeInput, raw);
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(allowanceTypes)
      .values({ id, orgId: actor.orgId, code: input.code, name: input.name })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) throw new AppError("conflict", "Another allowance type already uses this code.");
        throw err;
      });
    await recordAudit(tx, ports, actor, {
      action: "allowance_type.created",
      targetType: "allowance_type",
      targetId: id,
      meta: input,
    });
  });
  return { id, code: input.code, name: input.name, archived: false };
}

/** Reveal is identity's job (re-auth, rate limit, audit); this only decrypts for it. */
export async function decryptIdNumber(deps: AppDeps, ports: PeoplePorts, actor: Actor, employeeId: string) {
  await assertCanRead(actor, "personal", employeeId);
  const e = await loadEmployee(deps.db, actor.orgId, employeeId);
  return ports.secretBox.decrypt("nric", e.idNumberEnc);
}
