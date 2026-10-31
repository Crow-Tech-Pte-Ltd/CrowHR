import { SgRulesInputError } from "../errors.ts";
import {
  compare,
  type ExactCents,
  exactCents,
  exactDollarsText,
  min,
  roundHalfUpToCent,
  scale,
} from "../internal/exact.ts";
import { assertCents, money } from "../internal/money.ts";
import { pickInForce } from "../tables/effective.ts";
import { OVERTIME_RULES } from "../tables/employment-act.ts";
import type { Cents, IsoDate, RuleIssue, WorkingStep } from "../types.ts";
import { hourlyBasicRate, isPart4Covered } from "./rates.ts";

/**
 * How the non-workman hourly OT base is derived.
 * - `MOM_PUBLISHED_CAP` (default): exact hourly basic rate, but for non-workmen never above MOM's
 *   published cap of $13.60/h ("capped at the salary level of $2,600, or an hourly rate of $13.60").
 *   Reproduces MOM's example: $13.60 × 1.5 × 2 h = $40.80.
 * - `EXACT_FORMULA`: (12 × min(basic, $2,600)) / (52 × 44) without the $13.60 figure, i.e. $13.6364/h
 *   at the cap ($40.91 for MOM's example). Pays slightly more than MOM's example: an employer
 *   enhancement, not the published statutory figure.
 * In both, workmen are uncapped and the final OT amount is rounded half up to the cent (MOM publishes
 * no rounding rule; see VERIFICATION.md).
 */
export type OvertimeRateMethod = "MOM_PUBLISHED_CAP" | "EXACT_FORMULA";

export interface OvertimeInput {
  readonly date: IsoDate;
  readonly monthlyBasicCents: Cents;
  readonly isWorkman: boolean;
  readonly isManagerOrExecutive: boolean;
  /** Overtime worked, in whole minutes. */
  readonly overtimeMinutes: number;
  readonly method?: OvertimeRateMethod;
}

export interface OvertimeResult {
  /** Statutory OT entitlement applies (Part 4). When false, OT is contractual and `payCents` is 0. */
  readonly eligible: boolean;
  readonly payCents: Cents;
  readonly hourlyRateText: string | null;
  readonly method: OvertimeRateMethod;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

/** Hourly OT base after the non-workman cap, exact. */
export function overtimeHourlyBase(input: Pick<OvertimeInput, "date" | "monthlyBasicCents" | "isWorkman" | "method">): {
  hourly: ExactCents;
  text: string;
} {
  const rule = pickInForce(OVERTIME_RULES, input.date, "Employment Act overtime");
  const method = input.method ?? "MOM_PUBLISHED_CAP";
  if (input.isWorkman) {
    const r = hourlyBasicRate({ monthlyBasicCents: input.monthlyBasicCents, date: input.date });
    return { hourly: r.exact, text: `${r.text} (workman: no cap)` };
  }
  const base = Math.min(input.monthlyBasicCents, rule.nonWorkmanOtBaseCapMonthlyCents);
  const r = hourlyBasicRate({ monthlyBasicCents: base, date: input.date });
  const capText = base < input.monthlyBasicCents ? ` (basic capped at ${money(base)} for non-workmen)` : "";
  if (method === "EXACT_FORMULA") return { hourly: r.exact, text: `${r.text}${capText}` };
  const published = exactCents(rule.nonWorkmanPublishedHourlyCapCents);
  const hourly = min(r.exact, published);
  const usedCap = compare(r.exact, published) > 0;
  return {
    hourly,
    text: usedCap
      ? `${r.text}${capText}, limited to MOM's published non-workman hourly cap ${money(rule.nonWorkmanPublishedHourlyCapCents)}`
      : `${r.text}${capText}`,
  };
}

/** Overtime pay for Part 4 employees: hourly basic rate × 1.5 × hours, final amount rounded half up to the cent. */
export function computeOvertimePay(input: OvertimeInput): OvertimeResult {
  assertCents(input.monthlyBasicCents, "monthlyBasicCents");
  if (!Number.isInteger(input.overtimeMinutes) || input.overtimeMinutes < 0) {
    throw new SgRulesInputError(`overtimeMinutes must be a non-negative whole number, got ${input.overtimeMinutes}.`);
  }
  const method = input.method ?? "MOM_PUBLISHED_CAP";
  const rule = pickInForce(OVERTIME_RULES, input.date, "Employment Act overtime");
  const part4 = isPart4Covered(input);
  const issues: RuleIssue[] = [
    ...part4.issues,
    ...checkOvertimeLimits({ date: input.date, monthOvertimeMinutes: input.overtimeMinutes }),
  ];
  if (!part4.covered) {
    return {
      eligible: false,
      payCents: 0,
      hourlyRateText: null,
      method,
      working: [
        ...part4.working,
        {
          code: "EA_OT_NOT_STATUTORY",
          text: "No statutory overtime entitlement; any overtime pay is contractual (company policy).",
        },
      ],
      issues,
    };
  }
  const { hourly, text } = overtimeHourlyBase(input);
  const exact = scale(hourly, BigInt(rule.multiplierBps) * BigInt(input.overtimeMinutes), 10_000n * 60n);
  const payCents = roundHalfUpToCent(exact);
  const hours = input.overtimeMinutes / 60;
  return {
    eligible: true,
    payCents,
    hourlyRateText: text,
    method,
    working: [
      ...part4.working,
      { code: "EA_OT_HOURLY", text },
      {
        code: "EA_OT_PAY",
        text: `OT pay = hourly rate × ${rule.multiplierBps / 10_000} × ${hours} h = $${exactDollarsText(exact)} → ${money(payCents)} (rounded half up to the cent).`,
      },
    ],
    issues,
  };
}

export interface OvertimeLimitInput {
  readonly date: IsoDate;
  /** OT minutes in the calendar month that count toward the limit (rest-day/PH hours only beyond normal daily hours). */
  readonly monthOvertimeMinutes: number;
  /** Total minutes worked on individual days, to check the 12-hour daily maximum. */
  readonly dailyMinutesWorked?: readonly { readonly date: IsoDate; readonly minutes: number }[];
}

/** 72 OT hours a month (unless MOM exempts) and 12 hours a day. Returns warnings; never throws for a breach. */
export function checkOvertimeLimits(input: OvertimeLimitInput): RuleIssue[] {
  const rule = pickInForce(OVERTIME_RULES, input.date, "Employment Act overtime");
  const issues: RuleIssue[] = [];
  if (input.monthOvertimeMinutes > rule.maxOvertimeHoursPerMonth * 60) {
    issues.push({
      code: "EA_OT_MONTHLY_LIMIT",
      severity: "warning",
      message: `${input.monthOvertimeMinutes / 60} OT hours this month exceeds the ${rule.maxOvertimeHoursPerMonth}-hour limit. Pay the hours worked; this is lawful only with an MOM exemption.`,
      source: rule.source,
    });
  }
  for (const d of input.dailyMinutesWorked ?? []) {
    if (d.minutes > rule.maxHoursPerDay * 60) {
      issues.push({
        code: "EA_DAILY_HOURS_LIMIT",
        severity: "warning",
        message: `${d.date}: ${d.minutes / 60} hours worked exceeds the ${rule.maxHoursPerDay}-hour daily maximum.`,
        source: rule.source,
      });
    }
  }
  return issues;
}
