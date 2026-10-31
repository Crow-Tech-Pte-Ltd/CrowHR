import { SgRulesInputError } from "../errors.ts";
import type { RuleIssue, WorkingStep } from "../types.ts";
import { SOURCES } from "./tables.ts";

export interface PartTimeLeaveInput {
  /** Contractual hours a week of the part-time employee (quarter hours). */
  readonly partTimeHoursPerWeek: number;
  /** Hours a week of the comparable full-time employee (their actual hours, not a fixed 44). */
  readonly fullTimeHoursPerWeek: number;
  /** The full-timer's entitlement in days (multiples of 0.5). */
  readonly fullTimeEntitlementDays: number;
  /** The full-timer's normal hours a day (quarter hours). */
  readonly fullTimeHoursPerDay: number;
}

export interface PartTimeLeaveResult {
  /** Entitlement in hours, rounded half up to 1 decimal place. */
  readonly hours: number;
  readonly exactText: string;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

function quarters(value: number, field: string): bigint {
  const q = value * 4;
  if (!(value > 0) || !Number.isInteger(q))
    throw new SgRulesInputError(`${field} must be a positive number of hours in quarter hours, got ${value}.`);
  return BigInt(q);
}

/**
 * Part-time leave in hours (MOM): (part-time hours a year ÷ full-time hours a year) × full-time
 * entitlement in days × full-time hours a day. MOM's examples (20 of 44 h a week; 7, 14 and 60 days
 * at 8 h) give 25.5, 50.9 and 218.2 h, consistent with rounding to 1 decimal half up. The
 * Regulations could not be read, so the rounding carries a warning.
 */
export function partTimeLeaveHours(input: PartTimeLeaveInput): PartTimeLeaveResult {
  const pt = quarters(input.partTimeHoursPerWeek, "partTimeHoursPerWeek");
  const ft = quarters(input.fullTimeHoursPerWeek, "fullTimeHoursPerWeek");
  const hpd = quarters(input.fullTimeHoursPerDay, "fullTimeHoursPerDay");
  const days2 = input.fullTimeEntitlementDays * 2;
  if (!(input.fullTimeEntitlementDays >= 0) || !Number.isInteger(days2))
    throw new SgRulesInputError(
      `fullTimeEntitlementDays must be a non-negative multiple of 0.5, got ${input.fullTimeEntitlementDays}.`,
    );
  if (pt > ft)
    throw new SgRulesInputError("partTimeHoursPerWeek cannot exceed the comparable full-timer's hours a week.");
  // hours = (pt/4)/(ft/4) × (days2/2) × (hpd/4) = pt × days2 × hpd / (ft × 8). Weeks a year cancel out.
  const num = pt * BigInt(days2) * hpd;
  const den = ft * 8n;
  const tenths = (2n * num * 10n + den) / (2n * den);
  const hours = Number(tenths) / 10;
  const exact = Number(num) / Number(den);
  const exactText = `(${input.partTimeHoursPerWeek} × 52) / (${input.fullTimeHoursPerWeek} × 52) × ${input.fullTimeEntitlementDays} days × ${input.fullTimeHoursPerDay} h = ${exact.toFixed(4)} h`;
  return {
    hours,
    exactText,
    working: [{ code: "PT_LEAVE_HOURS", text: `${exactText} → ${hours} h (rounded half up to 1 decimal place).` }],
    issues: [
      {
        code: "PT_LEAVE_ROUNDING_UNVERIFIED",
        severity: "warning",
        message:
          "Rounding to 1 decimal place matches MOM's examples; the Part-Time Employees Regulations could not be read to confirm it.",
        source: SOURCES.partTime,
      },
    ],
  };
}
