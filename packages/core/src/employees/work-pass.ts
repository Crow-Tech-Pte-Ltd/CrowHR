import { and, asc, eq } from "drizzle-orm";
import { type WorkPass, workPasses } from "../db/schema/employees.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { WORK_PASS_REMINDER_DAYS, WORK_PASS_TYPES } from "../organisation/statutory.ts";
import { type Actor, assertCanRead, assertCanWrite } from "./access.ts";
import { diffOf, recordAudit } from "./audit-helpers.ts";
import { addDays, singaporeToday } from "./dates.ts";
import { maskTail } from "./nric.ts";
import type { PeoplePorts } from "./ports.ts";
import { workPassInput, workPassPatch } from "./schemas.ts";
import { parseInput } from "./validation.ts";

export async function sealWorkPass(
  ports: PeoplePorts,
  passNumber: string | null | undefined,
): Promise<{ enc: string | null; masked: string | null }> {
  if (!passNumber) return { enc: null, masked: null };
  const value = passNumber.replace(/\s+/g, "").toUpperCase();
  return { enc: await ports.secretBox.encrypt("work-pass", value), masked: maskTail(value) };
}

export type PassState = "valid" | "expiring" | "expired" | "cancelled";

export function passState(p: Pick<WorkPass, "expiresOn" | "cancelledOn">, today: string): PassState {
  if (p.cancelledOn && p.cancelledOn <= today) return "cancelled";
  if (p.expiresOn < today) return "expired";
  if (p.expiresOn <= addDays(today, WORK_PASS_REMINDER_DAYS)) return "expiring";
  return "valid";
}

export interface WorkPassView {
  id: string;
  passType: string;
  passTypeLabel: string;
  passNumberMasked: string | null;
  issuedOn: string | null;
  expiresOn: string;
  cancelledOn: string | null;
  notes: string | null;
  state: PassState;
}

export function toPassView(p: WorkPass, today: string): WorkPassView {
  return {
    id: p.id,
    passType: p.passType,
    passTypeLabel: WORK_PASS_TYPES.find((t) => t.code === p.passType)?.label ?? p.passType,
    passNumberMasked: p.passNumberMasked,
    issuedOn: p.issuedOn,
    expiresOn: p.expiresOn,
    cancelledOn: p.cancelledOn,
    notes: p.notes,
    state: passState(p, today),
  };
}

/**
 * The employee's pass status for the list: "expired" only when the latest
 * pass has expired and there is no later pass (spec: Work passes).
 */
export function overallPassState(passes: readonly WorkPass[], today: string): PassState | null {
  if (!passes.length) return null;
  const latest = [...passes].sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1))[0] as WorkPass;
  return passState(latest, today);
}

export async function listWorkPasses(deps: AppDeps, actor: Actor, employeeId: string): Promise<WorkPassView[]> {
  await assertCanRead(actor, "work_pass", employeeId);
  const rows = await deps.db
    .select()
    .from(workPasses)
    .where(and(eq(workPasses.orgId, actor.orgId), eq(workPasses.employeeId, employeeId)))
    .orderBy(asc(workPasses.expiresOn));
  const today = singaporeToday(deps.clock.now());
  return rows.map((p) => toPassView(p, today));
}

export async function addWorkPass(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  employeeId: string,
  raw: unknown,
): Promise<WorkPassView> {
  assertCanWrite(actor, "work_pass");
  await assertCanRead(actor, "directory", employeeId);
  const input = parseInput(workPassInput, raw);
  const sealed = await sealWorkPass(ports, input.passNumber);
  const id = deps.ids.newId();
  const [row] = await deps.db
    .insert(workPasses)
    .values({
      id,
      orgId: actor.orgId,
      employeeId,
      passType: input.passType,
      passNumberEnc: sealed.enc,
      passNumberMasked: sealed.masked,
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn,
      notes: input.notes ?? null,
    })
    .returning()
    .catch((err: unknown) => {
      throw notFoundOnFk(err);
    });
  await recordAudit(ports, actor, {
    action: "work_pass.created",
    targetType: "employee",
    targetId: employeeId,
    diff: diffOf(null, {
      passType: input.passType,
      passNumber: input.passNumber ? "set" : null,
      expiresOn: input.expiresOn,
    }),
  });
  return toPassView(row as WorkPass, singaporeToday(deps.clock.now()));
}

export async function updateWorkPass(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  employeeId: string,
  passId: string,
  raw: unknown,
): Promise<WorkPassView> {
  assertCanWrite(actor, "work_pass");
  const [before] = await deps.db
    .select()
    .from(workPasses)
    .where(and(eq(workPasses.orgId, actor.orgId), eq(workPasses.employeeId, employeeId), eq(workPasses.id, passId)));
  if (!before) throw new AppError("not_found", "No such work pass.");
  const input = parseInput(workPassPatch, raw);
  const set: Partial<WorkPass> = { updatedAt: deps.clock.now() };
  if (input.passType) set.passType = input.passType;
  if (input.issuedOn !== undefined) set.issuedOn = input.issuedOn ?? null;
  if (input.expiresOn) set.expiresOn = input.expiresOn;
  if (input.notes !== undefined) set.notes = input.notes ?? null;
  if (input.cancelledOn !== undefined) set.cancelledOn = input.cancelledOn ?? null;
  if (input.passNumber !== undefined) {
    const sealed = await sealWorkPass(ports, input.passNumber);
    set.passNumberEnc = sealed.enc;
    set.passNumberMasked = sealed.masked;
  }
  const issued = set.issuedOn !== undefined ? set.issuedOn : before.issuedOn;
  const expires = set.expiresOn ?? before.expiresOn;
  if (issued && issued > expires) {
    throw new AppError("validation_failed", "The expiry date must be on or after the issue date.", {
      target: "json",
      issues: [{ path: "expiresOn", message: "The expiry date must be on or after the issue date." }],
    });
  }
  const [row] = await deps.db.update(workPasses).set(set).where(eq(workPasses.id, passId)).returning();
  const { passNumberEnc: _e, passNumberMasked: _m, updatedAt: _u, ...visible } = set;
  await recordAudit(ports, actor, {
    action: "work_pass.updated",
    targetType: "employee",
    targetId: employeeId,
    diff: {
      ...diffOf(before as unknown as Record<string, unknown>, visible as Record<string, unknown>),
      ...(input.passNumber !== undefined ? { passNumber: { changed: true as const } } : {}),
    },
  });
  return toPassView(row as WorkPass, singaporeToday(deps.clock.now()));
}

export function notFoundOnFk(err: unknown): unknown {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
  return code === "23503" ? new AppError("not_found", "No such employee.") : err;
}
