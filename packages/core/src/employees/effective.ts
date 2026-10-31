import { and, eq, gt, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";
import type { IsoDate } from "./dates.ts";

/**
 * Effective-dating convention shared by every module (design decision 2):
 *
 * - `effective_from date NOT NULL`, `effective_to date NULL`, half-open
 *   `[from, to)`; `to = null` means "until further notice".
 * - Inserting a version closes the one in force on its start date and, when
 *   later versions already exist (future-dated changes), ends the new one
 *   where the next begins. Both happen in the caller's transaction.
 * - Overlaps are rejected here (not by an exclusion constraint, which PGlite
 *   cannot guarantee) and covered by a property test.
 */
export interface Interval {
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

export function covers(iv: Interval, date: IsoDate): boolean {
  return iv.effectiveFrom <= date && (iv.effectiveTo === null || date < iv.effectiveTo);
}

/** The version in force on `date`, if any. */
export function findAsAt<T extends Interval>(rows: readonly T[], date: IsoDate): T | undefined {
  return rows.find((r) => covers(r, date));
}

function overlaps(a: Interval, b: Interval): boolean {
  const aEndsAfterBStarts = a.effectiveTo === null || a.effectiveTo > b.effectiveFrom;
  const bEndsAfterAStarts = b.effectiveTo === null || b.effectiveTo > a.effectiveFrom;
  return aEndsAfterBStarts && bEndsAfterAStarts;
}

/** Throws if any two versions overlap or any version is empty. */
export function assertNoOverlap(rows: readonly Interval[]): void {
  for (const r of rows) {
    if (r.effectiveTo !== null && r.effectiveTo <= r.effectiveFrom) {
      throw new AppError("conflict", `A version from ${r.effectiveFrom} ends on or before it starts.`);
    }
  }
  const sorted = [...rows].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as Interval;
    const cur = sorted[i] as Interval;
    if (overlaps(prev, cur)) {
      throw new AppError(
        "conflict",
        `Versions starting ${prev.effectiveFrom} and ${cur.effectiveFrom} overlap. Each date may be covered by one version only.`,
      );
    }
  }
}

export interface InsertPlan<T extends Interval & { id: string }> {
  /** The existing version to end at the new start date, if one covers it. */
  close: T | null;
  /** End of the new version: the start of the next existing version, or open. */
  newEffectiveTo: IsoDate | null;
}

/**
 * Where a new version starting `from` fits into an existing timeline.
 * Rejects a second version starting on the same date (correct it by
 * cancelling the scheduled one, or pick another date).
 */
export function planInsert<T extends Interval & { id: string }>(existing: readonly T[], from: IsoDate): InsertPlan<T> {
  if (existing.some((r) => r.effectiveFrom === from)) {
    throw new AppError(
      "conflict",
      `A change already takes effect on ${from}. Cancel that change first, or choose a different effective date.`,
      { reason: "same_effective_date", effectiveFrom: from },
    );
  }
  const close = findAsAt(existing, from) ?? null;
  const next = existing
    .filter((r) => r.effectiveFrom > from)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
  return { close, newEffectiveTo: next ? next.effectiveFrom : null };
}

/** Applies a plan to an in-memory timeline (used by the property test and by dry runs). */
export function applyInsert<T extends Interval & { id: string }>(
  existing: readonly T[],
  row: Omit<T, "effectiveTo">,
): T[] {
  const plan = planInsert(existing, row.effectiveFrom);
  const updated = existing.map((r) =>
    plan.close && r.id === plan.close.id ? { ...r, effectiveTo: row.effectiveFrom } : r,
  );
  return [...updated, { ...row, effectiveTo: plan.newEffectiveTo } as T];
}

/**
 * Removes a version and re-opens its predecessor (cancelling a scheduled
 * change). The predecessor's end becomes the removed version's end.
 */
export function applyRemove<T extends Interval & { id: string }>(existing: readonly T[], id: string): T[] {
  const removed = existing.find((r) => r.id === id);
  if (!removed) return [...existing];
  return existing
    .filter((r) => r.id !== id)
    .map((r) => (r.effectiveTo === removed.effectiveFrom ? { ...r, effectiveTo: removed.effectiveTo } : r));
}

// ---------------------------------------------------------------------------
// SQL helpers

export interface EffectiveColumns {
  orgId: PgColumn;
  employeeId: PgColumn;
  effectiveFrom: PgColumn;
  effectiveTo: PgColumn;
}

/** `effective_from <= d AND (effective_to IS NULL OR effective_to > d)`. */
export function inForceOn(cols: Pick<EffectiveColumns, "effectiveFrom" | "effectiveTo">, date: IsoDate): SQL {
  return and(lte(cols.effectiveFrom, date), or(isNull(cols.effectiveTo), gt(cols.effectiveTo, date))) as SQL;
}

type EffectiveTable = PgTable & EffectiveColumns;

/** The row of `table` in force for one employee on `date`. */
export async function asAt<T extends EffectiveTable>(
  db: Db,
  table: T,
  orgId: string,
  employeeId: string,
  date: IsoDate,
  extra?: SQL,
): Promise<T["$inferSelect"] | undefined> {
  const rows = await db
    .select()
    .from(table as PgTable)
    .where(and(eq(table.orgId, orgId), eq(table.employeeId, employeeId), inForceOn(table, date), extra))
    .limit(1);
  return rows[0] as T["$inferSelect"] | undefined;
}

/** Rows of `table` in force on `date` for many employees, keyed by employee id. */
export async function asAtMany<T extends EffectiveTable>(
  db: Db,
  table: T,
  orgId: string,
  employeeIds: readonly string[],
  date: IsoDate,
): Promise<Map<string, T["$inferSelect"]>> {
  const out = new Map<string, T["$inferSelect"]>();
  if (employeeIds.length === 0) return out;
  const rows = (await db
    .select()
    .from(table as PgTable)
    .where(
      and(eq(table.orgId, orgId), inArray(table.employeeId, [...employeeIds]), inForceOn(table, date)),
    )) as (T["$inferSelect"] & { employeeId: string })[];
  for (const row of rows) out.set(row.employeeId, row);
  return out;
}
