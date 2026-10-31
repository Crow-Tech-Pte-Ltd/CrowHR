import { RulesNotAvailableError } from "../errors.ts";
import type { IsoDate } from "../types.ts";

/**
 * Every rule row is effective over the half-open interval [effectiveFrom, effectiveTo):
 * `effectiveFrom` is inclusive, `effectiveTo` is EXCLUSIVE (the first day the row no longer
 * applies, i.e. the next version's `effectiveFrom`). `effectiveTo: null` = open-ended.
 */
export interface Effective {
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  /** Primary source URL for the numbers in this row. */
  readonly source: string;
  /**
   * How `effectiveFrom` is known. `PUBLISHED`: the regulator states the start date.
   * `ENGINE_COVERAGE_START`: the current amounts are verified (see `verifiedOn`) but the
   * historical start date is not published or not encoded; the row is applied only from the
   * engine's coverage start and earlier history is NOT claimed.
   */
  readonly effectiveFromBasis?: "PUBLISHED" | "ENGINE_COVERAGE_START";
  readonly verifiedOn?: IsoDate;
}

/** Earliest date for which this package encodes a complete, cited rule set. */
export const ENGINE_COVERAGE_START: IsoDate = "2025-01-01";

/** Date the encoded data was last verified against primary sources. */
export const RULES_VERIFIED_ON: IsoDate = "2026-10-31";

export function isInForce(row: Effective, date: IsoDate): boolean {
  return row.effectiveFrom <= date && (row.effectiveTo === null || date < row.effectiveTo);
}

/** The single row of `rows` in force on `date`, or throws. */
export function pickInForce<T extends Effective>(rows: readonly T[], date: IsoDate, what: string): T {
  const matches = rows.filter((r) => isInForce(r, date));
  if (matches.length === 1) return matches[0] as T;
  if (matches.length === 0) {
    throw new RulesNotAvailableError(
      `No ${what} rule is encoded for ${date}. Crow HR's Singapore rules cover ${ENGINE_COVERAGE_START} onwards; earlier dates need the historical table added with its source.`,
    );
  }
  throw new RulesNotAvailableError(`More than one ${what} rule is in force on ${date}; the rule data overlaps.`);
}

export interface RangeIssue {
  readonly family: string;
  readonly problem: string;
}

/**
 * Checks one family of rows (rows that are alternatives for the same thing) for overlaps, gaps,
 * inverted ranges and missing sources. Used by the data-integrity test.
 */
export function effectiveRangeIssues(family: string, rows: readonly Effective[]): RangeIssue[] {
  const issues: RangeIssue[] = [];
  const sorted = [...rows].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  sorted.forEach((row, i) => {
    if (!/^https:\/\//.test(row.source))
      issues.push({ family, problem: `row from ${row.effectiveFrom} has no https source` });
    if (row.effectiveTo !== null && row.effectiveTo <= row.effectiveFrom) {
      issues.push({ family, problem: `row from ${row.effectiveFrom} ends on or before it starts` });
    }
    const next = sorted[i + 1];
    if (next) {
      if (row.effectiveTo === null || row.effectiveTo > next.effectiveFrom) {
        issues.push({ family, problem: `rows from ${row.effectiveFrom} and ${next.effectiveFrom} overlap` });
      } else if (row.effectiveTo < next.effectiveFrom) {
        issues.push({ family, problem: `gap between ${row.effectiveTo} and ${next.effectiveFrom}` });
      }
    }
  });
  const first = sorted[0];
  if (!first) issues.push({ family, problem: "family has no rows" });
  else if (first.effectiveFrom > ENGINE_COVERAGE_START) {
    issues.push({
      family,
      problem: `first row starts ${first.effectiveFrom}, after coverage start ${ENGINE_COVERAGE_START}`,
    });
  }
  const last = sorted[sorted.length - 1];
  if (last && last.effectiveTo !== null)
    issues.push({ family, problem: `last row ends ${last.effectiveTo}; no open-ended row` });
  return issues;
}
