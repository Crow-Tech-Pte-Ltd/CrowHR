import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { type CapPeriod, type ClaimStatus, claimLines, claims } from "../db/schema/claims.ts";
import type { Db } from "../db/types.ts";
import { displayMonth } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { sgd } from "./money.ts";
import type { ClaimTypeRow } from "./types.ts";

/**
 * Caps (spec "Caps", design decision 2). Per employee and claim type, counted by the line's
 * expense date in its Asia/Singapore calendar month or year (expense dates are already SGT
 * calendar dates). `used` = approved + paid claims, `pending` = submitted claims.
 *
 * - Submit: this claim + used + pending ≤ cap.
 * - Approve: this claim + used ≤ cap (other submitted claims no longer count).
 * - Per-claim caps: the sum of this claim's lines of the type.
 *
 * Both take `pg_advisory_xact_lock` on (org, employee, type) first, so two concurrent
 * submissions or approvals for the same employee and type serialise and the second sees the
 * first. Locks are taken in a stable order (sorted type IDs) so two claims never deadlock.
 */

export interface CapPeriodRange {
  period: Exclude<CapPeriod, "none" | "per_claim">;
  from: string; // inclusive
  to: string; // exclusive
  label: string;
}

export function periodOf(period: Exclude<CapPeriod, "none" | "per_claim">, date: string): CapPeriodRange {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (period === "yearly") return { period, from: `${y}-01-01`, to: `${y + 1}-01-01`, label: String(y) };
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    period,
    from: `${y}-${String(m).padStart(2, "0")}-01`,
    to: `${ny}-${String(nm).padStart(2, "0")}-01`,
    label: displayMonth(y, m),
  };
}

export async function lockCaps(db: Db, orgId: string, employeeId: string, typeIds: readonly string[]) {
  for (const typeId of [...new Set(typeIds)].sort()) {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`claims:${orgId}:${employeeId}:${typeId}`}, 0))`,
    );
  }
}

/** Sum of SGD cents of the employee's lines of `typeId` in [from, to) on claims in `statuses`, excluding one claim. */
async function sumLines(
  db: Db,
  input: { orgId: string; employeeId: string; typeId: string; from: string; to: string; excludeClaimId: string | null },
  statuses: ClaimStatus[],
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum(${claimLines.sgdCents}), 0)::text` })
    .from(claimLines)
    .innerJoin(claims, and(eq(claims.orgId, claimLines.orgId), eq(claims.id, claimLines.claimId)))
    .where(
      and(
        eq(claimLines.orgId, input.orgId),
        eq(claims.employeeId, input.employeeId),
        eq(claimLines.claimTypeId, input.typeId),
        gte(claimLines.expenseDate, input.from),
        lt(claimLines.expenseDate, input.to),
        inArray(claims.status, statuses),
        input.excludeClaimId ? ne(claims.id, input.excludeClaimId) : undefined,
      ),
    );
  return Number(row?.total ?? 0);
}

export interface CapUsage {
  typeId: string;
  typeCode: string;
  typeName: string;
  period: Exclude<CapPeriod, "none">;
  periodLabel: string;
  capCents: number;
  usedCents: number;
  pendingCents: number;
  /** Cap minus used minus pending (not counting this claim), never below 0. */
  remainingCents: number;
  /** This claim's lines of the type in the period. */
  claimCents: number;
}

/** Usage of a capped type in the period containing `date` (excluding `excludeClaimId`). */
export async function usageFor(
  db: Db,
  input: { orgId: string; employeeId: string; type: ClaimTypeRow; date: string; excludeClaimId: string | null },
): Promise<Omit<CapUsage, "claimCents"> | null> {
  const t = input.type;
  if (t.capPeriod === "none" || t.capCents === null) return null;
  if (t.capPeriod === "per_claim") {
    return {
      typeId: t.id,
      typeCode: t.code,
      typeName: t.name,
      period: "per_claim",
      periodLabel: "per claim",
      capCents: t.capCents,
      usedCents: 0,
      pendingCents: 0,
      remainingCents: t.capCents,
    };
  }
  const range = periodOf(t.capPeriod, input.date);
  const q = {
    orgId: input.orgId,
    employeeId: input.employeeId,
    typeId: t.id,
    from: range.from,
    to: range.to,
    excludeClaimId: input.excludeClaimId,
  };
  const usedCents = await sumLines(db, q, ["approved", "paid"]);
  const pendingCents = await sumLines(db, q, ["submitted"]);
  return {
    typeId: t.id,
    typeCode: t.code,
    typeName: t.name,
    period: t.capPeriod,
    periodLabel: range.label,
    capCents: t.capCents,
    usedCents,
    pendingCents,
    remainingCents: Math.max(0, t.capCents - usedCents - pendingCents),
  };
}

interface LineForCap {
  index: number;
  claimTypeId: string;
  expenseDate: string;
  sgdCents: number;
}

/** Usage for every (capped type, period) the claim's lines touch. */
export async function claimCapUsage(
  db: Db,
  input: {
    orgId: string;
    employeeId: string;
    claimId: string;
    lines: readonly LineForCap[];
    types: ReadonlyMap<string, ClaimTypeRow>;
  },
): Promise<CapUsage[]> {
  const groups = new Map<string, { type: ClaimTypeRow; date: string; cents: number }>();
  for (const line of input.lines) {
    const type = input.types.get(line.claimTypeId);
    if (!type || type.capPeriod === "none" || type.capCents === null) continue;
    const key =
      type.capPeriod === "per_claim" ? type.id : `${type.id}:${periodOf(type.capPeriod, line.expenseDate).from}`;
    const g = groups.get(key) ?? { type, date: line.expenseDate, cents: 0 };
    g.cents += line.sgdCents;
    groups.set(key, g);
  }
  const out: CapUsage[] = [];
  for (const g of groups.values()) {
    const u = await usageFor(db, {
      orgId: input.orgId,
      employeeId: input.employeeId,
      type: g.type,
      date: g.date,
      excludeClaimId: input.claimId,
    });
    if (u) out.push({ ...u, claimCents: g.cents });
  }
  return out;
}

/**
 * Throws 422 `cap_exceeded` for the first (type, period) the claim would take past its cap.
 * `stage` = submit counts pending claims; approve counts only approved and paid ones.
 */
export function assertWithinCaps(usage: readonly CapUsage[], stage: "submit" | "approve"): void {
  for (const u of usage) {
    const counted = u.usedCents + (stage === "submit" ? u.pendingCents : 0);
    if (u.claimCents + counted <= u.capCents) continue;
    const remaining = Math.max(0, u.capCents - counted);
    const pending = stage === "submit" ? u.pendingCents : 0;
    const when = u.period === "per_claim" ? "per claim" : `for ${u.periodLabel}`;
    throw new AppError(
      "cap_exceeded",
      `${u.typeName} has a ${capPhrase(u.period)} cap of ${sgd(u.capCents)}: used ${sgd(u.usedCents)}, pending ${sgd(pending)}, remaining ${sgd(remaining)} ${when}. This claim asks for ${sgd(u.claimCents)}. Reduce the amount to ${sgd(remaining)} or less${stage === "approve" ? ", or reject the claim with this reason" : ""}.`,
      {
        typeId: u.typeId,
        typeCode: u.typeCode,
        typeName: u.typeName,
        period: u.period,
        periodLabel: u.periodLabel,
        capCents: u.capCents,
        usedCents: u.usedCents,
        pendingCents: pending,
        remainingCents: remaining,
        claimCents: u.claimCents,
      },
    );
  }
}

function capPhrase(period: CapUsage["period"]): string {
  return period === "per_claim" ? "per-claim" : period;
}
