import { parseDate } from "../internal/dates.ts";
import { pickInForce } from "../tables/effective.ts";
import { KET_RULES, type KetItem, RECORD_RETENTION_RULES } from "../tables/employment-records.ts";
import type { IsoDate } from "../types.ts";

export type { KetItem } from "../tables/employment-records.ts";

export interface KetRequirements {
  readonly items: readonly KetItem[];
  /** Last day to issue KETs (start date + 14 days), when `startDate` is given. */
  readonly issueBy: IsoDate | null;
  readonly minimumEmploymentDays: number;
  readonly source: string;
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The mandatory KET items in force on `asAt` (MOM "Key employment terms"), and the issue-by date
 * for an employee starting on `startDate`: "within 14 days after the start of employment", so a
 * 1 Jan start must have KETs by 15 Jan.
 */
export function ketRequirements(input: { asAt: IsoDate; startDate?: IsoDate }): KetRequirements {
  parseDate(input.asAt, "asAt");
  if (input.startDate) parseDate(input.startDate, "startDate");
  const rule = pickInForce(KET_RULES, input.asAt, "key employment terms");
  return {
    items: rule.items,
    issueBy: input.startDate ? addDaysIso(input.startDate, rule.issueWithinDays) : null,
    minimumEmploymentDays: rule.minimumEmploymentDays,
    source: rule.source,
  };
}

/**
 * The KET items an employee must receive: drops the fixed-term item for open-ended contracts, the
 * overtime items for employees not entitled to overtime, and the optional place of work.
 */
export function requiredKetItems(input: {
  asAt: IsoDate;
  fixedTerm: boolean;
  overtimeEntitled: boolean;
}): readonly KetItem[] {
  return ketRequirements({ asAt: input.asAt }).items.filter((i) => {
    if (i.condition === "fixed_term") return input.fixedTerm;
    if (i.condition === "overtime_entitled") return input.overtimeEntitled;
    if (i.condition === "optional") return false;
    return true;
  });
}

function addMonthsIso(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export interface RetentionResult {
  /** Earliest date on which the record may be reviewed for deletion; null while the employee is current. */
  readonly reviewFrom: IsoDate | null;
  readonly afterLeavingMonths: number;
  readonly currentEmployeeMonths: number;
  readonly source: string;
}

/**
 * Employment Act record keeping (MOM "Employment records"): an ex-employee's records are kept for
 * 12 months after they leave, so they may be reviewed for deletion from `lastWorkingDay` + 12
 * months. This is a statutory minimum, not a deletion date: other regimes (IRAS, CPF) may require
 * longer, so a caller must only flag records for human review.
 */
export function employmentRecordRetention(input: { asAt: IsoDate; lastWorkingDay: IsoDate | null }): RetentionResult {
  parseDate(input.asAt, "asAt");
  if (input.lastWorkingDay) parseDate(input.lastWorkingDay, "lastWorkingDay");
  const rule = pickInForce(RECORD_RETENTION_RULES, input.asAt, "employment record retention");
  return {
    reviewFrom: input.lastWorkingDay ? addMonthsIso(input.lastWorkingDay, rule.afterLeavingMonths) : null,
    afterLeavingMonths: rule.afterLeavingMonths,
    currentEmployeeMonths: rule.currentEmployeeMonths,
    source: rule.source,
  };
}
