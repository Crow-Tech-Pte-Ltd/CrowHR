import { and, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { singaporeDate } from "../access/scope.ts";
import { claimLines, claims } from "../db/schema/claims.ts";
import type { Db } from "../db/types.ts";
import { displayDate } from "../employees/dates.ts";
import { formatRateMicros } from "./money.ts";

/**
 * Exchange-rate sanity check (add-claims design "Risks"; close-claims-gaps "Exchange-rate
 * warning"). Rates are typed by hand, so a line whose rate is more than 20% away from the last
 * rate used in the organisation for that currency carries a warning for the approver. It never
 * blocks.
 *
 * "The last rate used" for a line of claim C in currency X: the rate on the most recently
 * submitted other claim in the same organisation that was submitted before C and is now
 * submitted, approved or paid, with a line in X (its last such line by position). Drafts,
 * rejected and withdrawn claims, other lines of C and other organisations never count.
 */

/** More than this many basis points (20%) away from the last rate used warns; exactly 20% does not. */
export const FX_WARNING_BASIS_POINTS = 2000;

/** Claim statuses whose rates count as "used". */
const USED = ["submitted", "approved", "paid"] as const;

export interface FxWarning {
  /** The last rate used for the currency, as stored ("0.300000"). */
  lastRate: string;
  /** The Singapore date the claim carrying that rate was submitted. */
  lastRateOn: string;
  /** (rate − last) / last in basis points: positive above, negative below; magnitude rounded up. */
  deviationBasisPoints: number;
}

const abs = (n: bigint) => (n < 0n ? -n : n);

/** Whether `rateMicros` is more than 20% of `lastMicros` away from it (integer arithmetic). */
export function exceedsFxThreshold(rateMicros: number, lastMicros: number): boolean {
  const last = BigInt(lastMicros);
  return abs(BigInt(rateMicros) - last) * 10_000n > BigInt(FX_WARNING_BASIS_POINTS) * last;
}

/**
 * Signed deviation in basis points, magnitude rounded up so a rate just over the threshold never
 * reads as exactly 20.00%. Capped at the largest safe integer.
 */
export function deviationBasisPoints(rateMicros: number, lastMicros: number): number {
  const last = BigInt(lastMicros);
  const diff = BigInt(rateMicros) - last;
  const bp = (abs(diff) * 10_000n + last - 1n) / last;
  const capped = bp > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(bp);
  return diff < 0n ? -capped : capped;
}

/** 3334 → "33.34%". */
export function formatBasisPoints(bp: number): string {
  const a = Math.abs(bp);
  return `${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}%`;
}

/** "MYR 0.400000 is 33.34% above the last MYR rate used, 0.300000 on 2 Nov 2026." */
export function fxWarningText(currency: string, rate: string, w: FxWarning): string {
  const way = w.deviationBasisPoints >= 0 ? "above" : "below";
  return `${currency} ${rate} is ${formatBasisPoints(w.deviationBasisPoints)} ${way} the last ${currency} rate used, ${w.lastRate} on ${displayDate(w.lastRateOn)}.`;
}

/** The last rate used per currency for a claim submitted at `submittedAt` (see the module comment). */
export async function lastRatesUsed(
  db: Db,
  orgId: string,
  claim: { id: string; submittedAt: Date },
  currencies: readonly string[],
): Promise<Map<string, { rateMicros: number; submittedAt: Date }>> {
  const wanted = [...new Set(currencies.filter((c) => c !== "SGD"))];
  if (!wanted.length) return new Map();
  const rows = await db
    .selectDistinctOn([claimLines.currency], {
      currency: claimLines.currency,
      rateMicros: claimLines.rateMicros,
      submittedAt: claims.submittedAt,
    })
    .from(claimLines)
    .innerJoin(claims, and(eq(claims.orgId, claimLines.orgId), eq(claims.id, claimLines.claimId)))
    .where(
      and(
        eq(claimLines.orgId, orgId),
        inArray(claimLines.currency, wanted),
        isNotNull(claimLines.rateMicros),
        ne(claims.id, claim.id),
        inArray(claims.status, [...USED]),
        lt(claims.submittedAt, claim.submittedAt),
      ),
    )
    .orderBy(claimLines.currency, desc(claims.submittedAt), desc(claims.id), desc(claimLines.position));
  const out = new Map<string, { rateMicros: number; submittedAt: Date }>();
  for (const r of rows) {
    if (r.rateMicros !== null && r.submittedAt)
      out.set(r.currency, { rateMicros: r.rateMicros, submittedAt: r.submittedAt });
  }
  return out;
}

/**
 * The warning for each line, in order (null when within 20%, SGD, no earlier rate, or the claim
 * has not been submitted).
 */
export async function fxWarnings(
  db: Db,
  orgId: string,
  claim: { id: string; submittedAt: Date | null },
  lines: readonly { currency: string; rateMicros: number | null }[],
): Promise<(FxWarning | null)[]> {
  const submittedAt = claim.submittedAt;
  if (!submittedAt) return lines.map(() => null);
  const last = await lastRatesUsed(
    db,
    orgId,
    { id: claim.id, submittedAt },
    lines.filter((l) => l.rateMicros !== null).map((l) => l.currency),
  );
  return lines.map((l) => {
    const ref = last.get(l.currency);
    if (l.currency === "SGD" || l.rateMicros === null || !ref || !exceedsFxThreshold(l.rateMicros, ref.rateMicros))
      return null;
    return {
      lastRate: formatRateMicros(ref.rateMicros),
      lastRateOn: singaporeDate(ref.submittedAt),
      deviationBasisPoints: deviationBasisPoints(l.rateMicros, ref.rateMicros),
    };
  });
}
