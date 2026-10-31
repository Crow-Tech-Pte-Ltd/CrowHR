import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  type WorkDayType,
  type WorkSchedule,
  type WorkScheduleVersion,
  type WorkWeek,
  workSchedules,
  workScheduleVersions,
} from "../db/schema/organisation.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { type Actor, assertCanWrite } from "../employees/access.ts";
import { recordAudit } from "../employees/audit-helpers.ts";
import { isIsoDate, singaporeToday } from "../employees/dates.ts";
import { findAsAt, planInsert } from "../employees/effective.ts";
import type { PeoplePorts } from "../employees/ports.ts";
import { isUniqueViolation, parseInput } from "../employees/validation.ts";
import { AppError } from "../errors.ts";
import { REST_DAYS_PER_WEEK } from "./statutory.ts";

/** Versions created with a schedule apply "since always", so older hires resolve too. */
export const SINCE_ALWAYS = "1970-01-01";
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-12-01." });

const day = z.object({
  type: z.enum(["working", "half", "off", "rest"]),
  minutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
});

const weekShape = z.object({
  kind: z.literal("fixed"),
  days: z.array(day).length(7, "Give all seven days, Monday first."),
});
const shiftShape = z.object({
  kind: z.literal("shift"),
  weeklyMinutes: z
    .number()
    .int()
    .min(1, "Enter the contracted hours per week.")
    .max(7 * 24 * 60),
});

export const scheduleBody = z.discriminatedUnion("kind", [weekShape, shiftShape]);

export const createScheduleInput = z.intersection(
  z.object({
    name: z.string().trim().min(1, "Enter a name, like Office 5-day.").max(80),
    isDefault: z.boolean().optional(),
  }),
  scheduleBody,
);

export const updateScheduleInput = z.intersection(
  z.object({
    name: z.string().trim().min(1).max(80).optional(),
    effectiveFrom: isoDate,
  }),
  scheduleBody,
);

export function validateWeek(days: WorkWeek): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const rest = days.filter((d) => d.type === "rest").length;
  if (rest !== REST_DAYS_PER_WEEK) {
    issues.push({
      path: "days",
      message:
        rest === 0
          ? "Mark exactly one day as the rest day (usually Sunday)."
          : `Mark exactly one day as the rest day; ${rest} are marked. Make the others off days.`,
    });
  }
  days.forEach((d, i) => {
    const label = WEEKDAYS[i];
    if ((d.type === "working" || d.type === "half") && d.minutes <= 0) {
      issues.push({ path: `days.${i}.minutes`, message: `Enter the contracted hours for ${label}.` });
    }
    if ((d.type === "off" || d.type === "rest") && d.minutes !== 0) {
      issues.push({ path: `days.${i}.minutes`, message: `${label} is a non-working day; set its hours to 0.` });
    }
  });
  const working = days.filter((d) => d.type === "working").map((d) => d.minutes);
  const full = working.length ? Math.max(...working) : 0;
  days.forEach((d, i) => {
    if (d.type === "half" && full > 0 && d.minutes >= full) {
      issues.push({
        path: `days.${i}.minutes`,
        message: `${WEEKDAYS[i]} is a half day, so it needs fewer hours than a full working day.`,
      });
    }
  });
  return issues;
}

function weeklyMinutesOf(body: z.output<typeof scheduleBody>): number {
  return body.kind === "fixed" ? body.days.reduce((s, d) => s + d.minutes, 0) : body.weeklyMinutes;
}

function assertBody(body: z.output<typeof scheduleBody>) {
  if (body.kind !== "fixed") return;
  const issues = validateWeek(body.days as WorkWeek);
  if (issues.length) {
    throw new AppError("validation_failed", issues[0]?.message ?? "Check the days.", { target: "json", issues });
  }
}

export interface WorkScheduleView {
  id: string;
  name: string;
  kind: "fixed" | "shift";
  isDefault: boolean;
  archived: boolean;
  current: { effectiveFrom: string; days: WorkWeek | null; weeklyMinutes: number } | null;
  versions: { effectiveFrom: string; effectiveTo: string | null; days: WorkWeek | null; weeklyMinutes: number }[];
}

function toView(s: WorkSchedule, versions: WorkScheduleVersion[], today: string): WorkScheduleView {
  const sorted = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const cur = findAsAt(sorted, today);
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    isDefault: s.isDefault,
    archived: s.archivedAt !== null,
    current: cur ? { effectiveFrom: cur.effectiveFrom, days: cur.days, weeklyMinutes: cur.weeklyMinutes } : null,
    versions: sorted.map((v) => ({
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      days: v.days,
      weeklyMinutes: v.weeklyMinutes,
    })),
  };
}

export async function listWorkSchedules(deps: AppDeps, actor: Actor): Promise<WorkScheduleView[]> {
  const rows = await deps.db
    .select()
    .from(workSchedules)
    .where(eq(workSchedules.orgId, actor.orgId))
    .orderBy(asc(workSchedules.name));
  const versions = await deps.db.select().from(workScheduleVersions).where(eq(workScheduleVersions.orgId, actor.orgId));
  const today = singaporeToday(deps.clock.now());
  return rows.map((s) =>
    toView(
      s,
      versions.filter((v) => v.scheduleId === s.id),
      today,
    ),
  );
}

async function getView(deps: AppDeps, actor: Actor, id: string): Promise<WorkScheduleView> {
  const all = await listWorkSchedules(deps, actor);
  const found = all.find((s) => s.id === id);
  if (!found) throw new AppError("not_found", "No such work schedule.");
  return found;
}

export async function createWorkSchedule(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  raw: unknown,
): Promise<WorkScheduleView> {
  assertCanWrite(actor, "structure");
  const input = parseInput(createScheduleInput, raw);
  assertBody(input);
  const id = deps.ids.newId();
  await deps.db
    .transaction(async (tx) => {
      const existing = await tx
        .select({ id: workSchedules.id })
        .from(workSchedules)
        .where(and(eq(workSchedules.orgId, actor.orgId), eq(workSchedules.isDefault, true)));
      const makeDefault = input.isDefault === true || existing.length === 0;
      if (makeDefault && existing.length) {
        await tx.update(workSchedules).set({ isDefault: false }).where(eq(workSchedules.orgId, actor.orgId));
      }
      await tx.insert(workSchedules).values({
        id,
        orgId: actor.orgId,
        name: input.name,
        kind: input.kind,
        isDefault: makeDefault,
      });
      await tx.insert(workScheduleVersions).values({
        id: deps.ids.newId(),
        orgId: actor.orgId,
        scheduleId: id,
        effectiveFrom: SINCE_ALWAYS,
        effectiveTo: null,
        days: input.kind === "fixed" ? (input.days as WorkWeek) : null,
        weeklyMinutes: weeklyMinutesOf(input),
      });
      await recordAudit(tx, ports, actor, {
        action: "work_schedule.created",
        targetType: "work_schedule",
        targetId: id,
        meta: { name: input.name, kind: input.kind, weeklyMinutes: weeklyMinutesOf(input) },
      });
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw new AppError("conflict", "Another active work schedule already has this name.", { reason: "name_taken" });
      }
      throw err;
    });
  return getView(deps, actor, id);
}

/** A change creates a new version from `effectiveFrom`; history before that date is untouched. */
export async function updateWorkSchedule(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  id: string,
  raw: unknown,
): Promise<WorkScheduleView> {
  assertCanWrite(actor, "structure");
  const input = parseInput(updateScheduleInput, raw);
  assertBody(input);
  await deps.db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(workSchedules)
      .where(and(eq(workSchedules.orgId, actor.orgId), eq(workSchedules.id, id)))
      .for("update");
    if (!s) throw new AppError("not_found", "No such work schedule.");
    if (s.kind !== input.kind) {
      throw new AppError("validation_failed", "A schedule cannot change between fixed and shift. Create a new one.", {
        target: "json",
        issues: [{ path: "kind", message: "Keep the schedule's kind, or create a new schedule." }],
      });
    }
    const versions = await tx
      .select()
      .from(workScheduleVersions)
      .where(and(eq(workScheduleVersions.orgId, actor.orgId), eq(workScheduleVersions.scheduleId, id)));
    const plan = planInsert(versions, input.effectiveFrom);
    if (plan.close) {
      await tx
        .update(workScheduleVersions)
        .set({ effectiveTo: input.effectiveFrom })
        .where(eq(workScheduleVersions.id, plan.close.id));
    }
    await tx.insert(workScheduleVersions).values({
      id: deps.ids.newId(),
      orgId: actor.orgId,
      scheduleId: id,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: plan.newEffectiveTo,
      days: input.kind === "fixed" ? (input.days as WorkWeek) : null,
      weeklyMinutes: weeklyMinutesOf(input),
    });
    if (input.name && input.name !== s.name) {
      await tx
        .update(workSchedules)
        .set({ name: input.name, updatedAt: deps.clock.now() })
        .where(eq(workSchedules.id, id));
    }
    await recordAudit(tx, ports, actor, {
      action: "work_schedule.versioned",
      targetType: "work_schedule",
      targetId: id,
      meta: { effectiveFrom: input.effectiveFrom, weeklyMinutes: weeklyMinutesOf(input) },
    });
  });
  return getView(deps, actor, id);
}

export async function setDefaultWorkSchedule(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  id: string,
): Promise<WorkScheduleView> {
  assertCanWrite(actor, "structure");
  await deps.db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(workSchedules)
      .where(and(eq(workSchedules.orgId, actor.orgId), eq(workSchedules.id, id)));
    if (!s) throw new AppError("not_found", "No such work schedule.");
    if (s.archivedAt) throw new AppError("conflict", "Restore this schedule before making it the default.");
    await tx
      .update(workSchedules)
      .set({ isDefault: false })
      .where(and(eq(workSchedules.orgId, actor.orgId), ne(workSchedules.id, id)));
    await tx.update(workSchedules).set({ isDefault: true }).where(eq(workSchedules.id, id));
    await recordAudit(tx, ports, actor, {
      action: "work_schedule.default_set",
      targetType: "work_schedule",
      targetId: id,
    });
  });
  return getView(deps, actor, id);
}

/** The schedule version in force on `date` (leave and OT use this). */
export async function workScheduleAsAt(
  db: Db,
  orgId: string,
  scheduleId: string,
  date: string,
): Promise<{ kind: "fixed" | "shift"; days: WorkWeek | null; weeklyMinutes: number } | null> {
  const [s] = await db
    .select()
    .from(workSchedules)
    .where(and(eq(workSchedules.orgId, orgId), eq(workSchedules.id, scheduleId)));
  if (!s) return null;
  const versions = await db
    .select()
    .from(workScheduleVersions)
    .where(and(eq(workScheduleVersions.orgId, orgId), eq(workScheduleVersions.scheduleId, scheduleId)));
  const v = findAsAt(versions, date);
  return v ? { kind: s.kind, days: v.days, weeklyMinutes: v.weeklyMinutes } : null;
}

/** Day type on a calendar date (Monday-first index from the ISO weekday). */
export function dayTypeOn(days: WorkWeek, date: string): WorkDayType {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const idx = (dow + 6) % 7;
  return (days[idx] as { type: WorkDayType }).type;
}

export async function defaultWorkScheduleId(db: Db, orgId: string): Promise<string | null> {
  const [s] = await db
    .select({ id: workSchedules.id })
    .from(workSchedules)
    .where(and(eq(workSchedules.orgId, orgId), eq(workSchedules.isDefault, true)));
  return s?.id ?? null;
}
