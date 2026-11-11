import {
  adoptionLeave,
  annualLeaveEntitlement,
  type ChildFacts,
  childcareLeave,
  type FundingSegment,
  infantCareLeave,
  maternityLeave,
  type ParentalEntitlement,
  partTimeLeaveHours,
  paternityLeave,
  RulesNotAvailableError,
  serviceMonthsBefore,
  sharedParentalLeave,
  sickLeaveEntitlement,
} from "@crowhr/sg-rules";
import type { LeaveChild, LeavePolicy, LeaveType, LeaveUnit } from "../db/schema/leave.ts";
import { addDays, displayDate } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import {
  type EmployeeTime,
  employmentNear,
  latestTenureBy,
  patternOf,
  scheduleOn,
  tenureOn,
  workingDaysPerWeekOn,
} from "./calendar.ts";
import { PER_CHILD_CODES } from "./defaults.ts";

/**
 * Entitlements (design decision 2): computed on read from service, schedule and policy, each with
 * the working that explains it. Quantities are hundredths of the unit.
 */

export const EA_ANNUAL_SCALE = [7, 8, 9, 10, 11, 12, 13, 14] as const;

export interface EntitlementResult {
  /** False for types without a balance (NS, no-pay). */
  tracked: boolean;
  unit: LeaveUnit;
  hundredths: number;
  eligible: boolean;
  /** When an ineligible employee becomes eligible (service rule), if known. */
  eligibleFrom: string | null;
  explanation: string[];
  /** Parental leave: employer / government / unpaid by counted day. */
  funding: readonly FundingSegment[] | null;
  /** Per-child entitlement (maternity, paternity, shared parental, adoption). */
  perChild: boolean;
}

/** MOM rounding: "less than one-half, round it down; half or more, round it up to one day". */
export function roundLeaveDays(days: number): number {
  return Math.floor(days + 0.5 + 1e-9);
}

const floorHalf = (days: number) => Math.floor(days * 2 + 1e-9) / 2;

/** Statutory codes held in hours by part-timers (MOM part-time leave). Company working-day types too. */
const HOUR_CODES = new Set(["annual", "sick_outpatient", "hospitalisation"]);

export function unitFor(t: EmployeeTime, type: LeaveType, date: string): LeaveUnit {
  const emp = employmentNear(t, date);
  if (emp?.employmentType !== "part_time") return "days";
  // Unpaid leave is deducted from pay in (half) days, like statutory no-pay leave.
  if (!type.statutoryCode && !type.paid) return "days";
  if (type.statutoryCode ? HOUR_CODES.has(type.statutoryCode) : type.dayCounting === "working_days") return "hours";
  return "days";
}

export function childFacts(c: LeaveChild): ChildFacts {
  return {
    birthDate: c.birthDate,
    expectedDeliveryDate: c.expectedDeliveryDate,
    isCitizen: c.isCitizen,
    birthOrder: c.birthOrder,
    stillborn: c.stillborn,
    adoptionIntentDate: c.adoptionIntentDate,
  };
}

/** The comparable full-timer for part-time hours: the org's chosen (or default) fixed schedule. */
export function fullTimeReference(t: EmployeeTime): { weeklyHours: number; hoursPerDay: number; label: string } {
  const chosen = t.settings.fullTimeScheduleId ? t.schedules.get(t.settings.fullTimeScheduleId) : undefined;
  const schedule = chosen ?? [...t.schedules.values()].find((s) => s.isDefault && s.kind === "fixed");
  const version = schedule?.versions.at(-1);
  if (!schedule || !version?.days) {
    return { weeklyHours: 44, hoursPerDay: 8, label: "44 h a week, 8 h a day (no full-time schedule set)" };
  }
  const daily = Math.max(0, ...version.days.filter((d) => d.type === "working").map((d) => d.minutes)) / 60;
  return {
    weeklyHours: version.weeklyMinutes / 60,
    hoursPerDay: daily || 8,
    label: `${schedule.name}: ${version.weeklyMinutes / 60} h a week, ${daily || 8} h a day`,
  };
}

function toHours(t: EmployeeTime, days: number, date: string, explanation: string[]): number {
  const s = scheduleOn(t, date);
  const ptWeekly = (s?.version.weeklyMinutes ?? 0) / 60;
  const ft = fullTimeReference(t);
  if (ptWeekly <= 0 || days <= 0) return 0;
  const r = partTimeLeaveHours({
    partTimeHoursPerWeek: Math.min(ptWeekly, ft.weeklyHours),
    fullTimeHoursPerWeek: ft.weeklyHours,
    fullTimeEntitlementDays: days,
    fullTimeHoursPerDay: ft.hoursPerDay,
  });
  explanation.push(
    `Part-time: ${ptWeekly} h a week against the comparable full-timer (${ft.label}): ${r.exactText}. Rounded to 1 decimal place (MOM's examples; the regulation's rounding is not verified).`,
  );
  return Math.round(r.hours * 100);
}

/** Calendar months (from hire) containing approved no-pay leave, per the org's service rule. Caller supplies. */
export interface EntitlementOptions {
  year: number;
  /** The date the balance is evaluated at (service is counted up to the day before). */
  asOf: string;
  child?: LeaveChild | null;
  children?: readonly LeaveChild[];
  /** Months of service excluded because of no-pay leave (org setting). */
  excludedMonths?: number;
}

function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const i = y * 12 + (m - 1) + months;
  const ny = Math.floor(i / 12);
  const nm = (i % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, dim)).padStart(2, "0")}`;
}

/** First date on which `months` completed months of service have passed (service counted before that day). */
export function eligibleFromDate(hireDate: string, months: number): string {
  let d = addMonthsClamped(hireDate, months);
  for (let i = 0; i < 3 && serviceMonthsBefore(hireDate, d) < months; i++) d = addDays(d, 1);
  return d;
}

function result(
  partial: Partial<EntitlementResult> & Pick<EntitlementResult, "unit" | "explanation">,
): EntitlementResult {
  return {
    tracked: true,
    hundredths: 0,
    eligible: true,
    eligibleFrom: null,
    funding: null,
    perChild: false,
    ...partial,
  };
}

function policyDays(policy: LeavePolicy, serviceYear: number, statutoryDays: number): number {
  const e = policy.entitlement;
  if (e.basis === "fixed") return Math.max(e.days, statutoryDays);
  if (e.basis === "by_service") {
    const steps = [...e.steps].sort((a, b) => a.fromServiceYear - b.fromServiceYear);
    const step = [...steps].reverse().find((s) => serviceYear >= s.fromServiceYear) ?? steps[0];
    return Math.max(step?.days ?? 0, statutoryDays);
  }
  return statutoryDays;
}

export function entitlementFor(t: EmployeeTime, type: LeaveType, opts: EntitlementOptions): EntitlementResult {
  const code = type.statutoryCode;
  const policy = type.policy;
  const unit = unitFor(t, type, opts.asOf);
  const explanation: string[] = [];
  if (policy.entitlement.basis === "unlimited") {
    return result({ tracked: false, unit, explanation: ["No fixed allowance: apply for the days you need."] });
  }
  const yearStart = `${opts.year}-01-01`;
  const yearEnd = `${opts.year}-12-31`;
  // biome-ignore lint/complexity/useMathMinMax: ISO date strings compare as text, not numbers.
  const tenure = tenureOn(t, opts.asOf) ?? latestTenureBy(t, opts.asOf > yearEnd ? opts.asOf : yearEnd);
  if (!tenure) {
    return result({ unit, eligible: false, explanation: ["Not employed in this leave year."] });
  }
  const hire = tenure.hireDate;
  const excluded = opts.excludedMonths ?? 0;
  if (code && PER_CHILD_CODES.has(code)) return parental(t, type, hire, opts, unit);

  // Service requirement.
  const minMonths = policy.minServiceMonths;
  const eligibleFrom = eligibleFromDate(hire, minMonths + excluded);
  if (minMonths > 0 && opts.asOf < eligibleFrom) {
    return result({
      unit,
      eligible: false,
      eligibleFrom,
      explanation: [
        `Needs ${minMonths} months of service${excluded ? ` (plus ${excluded} excluded for no-pay leave)` : ""}. Eligible from ${displayDate(eligibleFrom)}.`,
      ],
    });
  }

  if (code === "childcare" || code === "extended_childcare" || code === "infant_care") {
    return perYearChildLeave(t, type, hire, opts, unit);
  }

  const leaving = tenure.lastWorkingDay && tenure.lastWorkingDay <= yearEnd ? tenure.lastWorkingDay : null;
  const firstYear = hire >= yearStart;
  // Completed months strictly before `d`, net of excluded months.
  const before = (from: string, d: string) => Math.max(0, serviceMonthsBefore(from, d) - excluded);
  const cap = (d: string) => {
    const end = addDays(leaving ?? yearEnd, 1);
    return d < end ? d : end;
  };

  let days: number;
  if (code === "sick_outpatient" || code === "hospitalisation") {
    const s = sickLeaveEntitlement({ employmentStartDate: hire, asOfDate: addDays(opts.asOf, -1) });
    const statutory = code === "hospitalisation" ? s.hospitalisationDays : s.outpatientDays;
    explanation.push(s.working[0]?.text ?? "");
    days = policy.entitlement.basis === "statutory" ? statutory : policyDays(policy, 1, statutory);
    if (days > statutory) explanation.push(`Company policy: ${days} days.`);
    if (code === "hospitalisation") {
      explanation.push("Hospitalisation days include outpatient sick days taken.");
    }
  } else {
    // Annual leave and company types: full-year days by service year (as at the end of the year or the last day).
    const ref = leaving ?? yearEnd;
    const monthsAtRef = before(hire, addDays(ref, 1));
    const serviceYear = Math.floor(monthsAtRef / 12) + 1;
    let statutory = 0;
    if (code === "annual") {
      statutory = annualLeaveEntitlement({
        employmentStartDate: hire,
        asOfDate: ref,
        excludedMonths: excluded,
      }).fullYearDays;
    }
    const full = policyDays(policy, serviceYear, statutory);
    explanation.push(
      code === "annual"
        ? `Service year ${serviceYear} by ${displayDate(ref)}: ${full} days a year${full > statutory ? ` (company policy; statutory ${statutory})` : " (Employment Act)"}.`
        : `${full} days a year.`,
    );
    if (policy.prorate && firstYear) {
      const months = before(hire, cap(opts.asOf));
      days = roundLeaveDays((months * full) / 12);
      explanation.push(
        `First year of service: ${months} completed months by ${displayDate(addDays(cap(opts.asOf), -1))} → ${months}/12 × ${full} = ${((months * full) / 12).toFixed(2)} → ${days} days (half a day or more rounds up).`,
      );
    } else if (policy.prorate && leaving) {
      const months = serviceMonthsBefore(yearStart, addDays(leaving, 1));
      days = roundLeaveDays((months * full) / 12);
      explanation.push(
        `Leaving on ${displayDate(leaving)}: ${months}/12 × ${full} = ${((months * full) / 12).toFixed(2)} → ${days} days.`,
      );
    } else if (policy.accrual === "monthly") {
      const months = Math.min(12, serviceMonthsBefore(firstYear ? hire : yearStart, cap(opts.asOf)));
      days = months >= 12 ? full : floorHalf((months * full) / 12);
      explanation.push(`Earned monthly: ${months} of 12 months → ${days} days so far.`);
    } else {
      days = full;
    }
  }
  const hundredths = unit === "hours" ? toHours(t, days, opts.asOf, explanation) : Math.round(days * 100);
  return result({ unit, hundredths, eligibleFrom: minMonths > 0 ? eligibleFrom : null, explanation });
}

function perYearChildLeave(
  _t: EmployeeTime,
  type: LeaveType,
  hire: string,
  opts: EntitlementOptions,
  unit: LeaveUnit,
): EntitlementResult {
  const children = (opts.children ?? []).map(childFacts);
  if (!children.length) {
    return result({
      unit,
      eligible: false,
      explanation: [
        "Add your child in My leave → Children first. Childcare leave depends on the child's age and citizenship.",
      ],
    });
  }
  try {
    const input = { children, year: opts.year, employmentStartDate: hire, asOfDate: opts.asOf };
    if (type.statutoryCode === "infant_care") {
      const r = infantCareLeave(input);
      return result({
        unit: "days",
        eligible: r.eligible,
        hundredths: r.eligible ? r.days * 100 : 0,
        explanation: [...r.reasons, ...r.working.map((w) => w.text)],
        funding: [{ fromDay: 1, toDay: Math.max(1, r.days), payer: "unpaid" }],
      });
    }
    const r = childcareLeave(input);
    const ecl = type.statutoryCode === "extended_childcare";
    const days = ecl ? r.eclDays : r.gpclDays + r.eaChildcareDays;
    const funding = ecl ? r.funding.ecl : [...r.funding.gpcl, ...r.funding.ea];
    return result({
      unit: "days",
      eligible: days > 0,
      hundredths: days * 100,
      explanation: [...r.working.map((w) => w.text), ...(days > 0 ? [] : r.reasons)],
      funding,
    });
  } catch (err) {
    if (err instanceof RulesNotAvailableError) {
      return result({ unit, eligible: false, explanation: [err.message] });
    }
    throw err;
  }
}

function parental(
  t: EmployeeTime,
  type: LeaveType,
  hire: string,
  opts: EntitlementOptions,
  unit: LeaveUnit,
): EntitlementResult {
  const child = opts.child;
  if (!child) {
    return result({
      unit,
      eligible: false,
      perChild: true,
      explanation: ["Choose the child this leave is for (add them in My leave → Children)."],
    });
  }
  const facts = childFacts(child);
  const ref = child.birthDate ?? child.expectedDeliveryDate ?? child.adoptionIntentDate ?? opts.asOf;
  const workingDaysPerWeek = workingDaysPerWeekOn(t, ref);
  let r: ParentalEntitlement;
  try {
    switch (type.statutoryCode) {
      case "maternity":
        r = maternityLeave({ child: facts, employmentStartDate: hire, workingDaysPerWeek });
        break;
      case "paternity":
        r = paternityLeave({
          child: facts,
          employmentStartDate: hire,
          workingDaysPerWeek,
          marriedToMother: child.marriedToMother ?? false,
        });
        break;
      case "shared_parental":
        r = sharedParentalLeave({
          child: facts,
          employmentStartDate: hire,
          workingDaysPerWeek,
          parent: t.gender === "female" ? "mother" : "father",
          marriedToMother: child.marriedToMother ?? undefined,
        });
        break;
      default:
        r = adoptionLeave({ child: facts, employmentStartDate: hire, workingDaysPerWeek });
    }
  } catch (err) {
    if (err instanceof RulesNotAvailableError) {
      return result({ unit, eligible: false, perChild: true, explanation: [err.message] });
    }
    throw err;
  }
  return result({
    unit: "days",
    eligible: r.eligible,
    hundredths: Math.round(r.workingDays * 100),
    perChild: true,
    funding: r.funding,
    explanation: [
      ...(r.eligible
        ? [`${r.scheme}: ${r.weeks} weeks × ${workingDaysPerWeek} working days a week = ${r.workingDays} days.`]
        : []),
      ...r.reasons,
      ...r.working.map((w) => w.text),
    ],
  });
}

/** Refuses a policy below the statutory floor (spec scenario "Policy below statutory"). */
export function assertPolicyAtLeastStatutory(type: Pick<LeaveType, "statutoryCode">, policy: LeavePolicy): void {
  const code = type.statutoryCode;
  if (!code) return;
  const e = policy.entitlement;
  if (code === "ns" || code === "no_pay") {
    if (e.basis !== "unlimited") {
      throw new AppError(
        "below_statutory",
        'NS and no-pay leave have no fixed allowance. Keep the entitlement as "No limit".',
      );
    }
    return;
  }
  if (e.basis === "unlimited") {
    throw new AppError(
      "below_statutory",
      "This statutory leave has an entitlement set by law. Choose Statutory or a higher number of days.",
    );
  }
  if (PER_CHILD_CODES.has(code) || code === "childcare" || code === "extended_childcare" || code === "infant_care") {
    if (e.basis !== "statutory") {
      throw new AppError(
        "below_statutory",
        "Government-paid parental and childcare leave follows the statutory rules. Keep it on Statutory.",
      );
    }
    if (policy.minServiceMonths > 3) {
      throw new AppError("below_statutory", "The statutory service requirement is 3 months. Set 3 or fewer.");
    }
    return;
  }
  if (policy.minServiceMonths > 3) {
    throw new AppError("below_statutory", "The Employment Act needs at most 3 months of service. Set 3 or fewer.");
  }
  const floor =
    code === "annual"
      ? (y: number) => EA_ANNUAL_SCALE[Math.min(y, 8) - 1] ?? 14
      : () => (code === "hospitalisation" ? 60 : 14);
  const check = (serviceYear: number, days: number) => {
    const min = floor(serviceYear);
    if (days < min) {
      throw new AppError(
        "below_statutory",
        code === "annual"
          ? `Service year ${serviceYear} needs at least ${min} days of annual leave under the Employment Act. Set ${min} or more.`
          : `${code === "hospitalisation" ? "Hospitalisation" : "Outpatient sick"} leave needs at least ${min} days a year after 6 months of service. Set ${min} or more.`,
        { serviceYear, minimumDays: min },
      );
    }
  };
  if (e.basis === "fixed") {
    if (code === "annual") for (let y = 1; y <= 8; y++) check(y, e.days);
    else check(1, e.days);
  } else if (e.basis === "by_service") {
    const steps = [...e.steps].sort((a, b) => a.fromServiceYear - b.fromServiceYear);
    if (!steps.length || steps[0]?.fromServiceYear !== 1) {
      throw new AppError("validation_failed", "Start the service steps at year 1.", {
        issues: [{ path: "policy.entitlement.steps", message: "The first step must be for service year 1." }],
      });
    }
    for (let y = 1; y <= 8; y++) {
      const step = [...steps].reverse().find((s) => y >= s.fromServiceYear);
      check(y, step?.days ?? 0);
    }
  }
  if (code !== "annual" && policy.prorate) {
    throw new AppError("validation_failed", "Sick leave is not pro-rated by month; it follows the statutory steps.", {
      issues: [{ path: "policy.prorate", message: "Turn off pro-rating for sick and hospitalisation leave." }],
    });
  }
}

/** Working-day pattern helper re-exported for attendance. */
export { patternOf };
