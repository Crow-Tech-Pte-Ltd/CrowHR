import { SgRulesInputError } from "../errors.ts";
import { addDays, completedMonths, dateLabel, parseDate } from "../internal/dates.ts";
import { money } from "../internal/money.ts";
import { pickInForce } from "../tables/effective.ts";
import type { IsoDate, WorkingStep } from "../types.ts";
import {
  ADOPTION_RULES,
  EA_MATERNITY_RULES,
  type FundingRule,
  GPML_RULES,
  PATERNITY_RULES,
  PATERNITY_STILLBIRTH_WEEKS,
  SHARED_PARENTAL_RULES,
  SOURCES,
} from "./tables.ts";

/** What the employee declares about a child (the leave module keeps a child registry). */
export interface ChildFacts {
  /** Null before the birth. */
  readonly birthDate: IsoDate | null;
  readonly expectedDeliveryDate: IsoDate | null;
  /** Singapore Citizen, or declared to become one within 12 months. */
  readonly isCitizen: boolean;
  /** 1-based order of this child for this parent (funding: 1st/2nd vs 3rd and later). */
  readonly birthOrder: number;
  readonly stillborn?: boolean;
  /** Formal intent to adopt (adoption). */
  readonly adoptionIntentDate?: IsoDate | null;
}

export type Payer = "employer" | "government" | "unpaid";

/** Who pays which working days of an entitlement: 1-based day numbers, inclusive. */
export interface FundingSegment {
  readonly fromDay: number;
  readonly toDay: number;
  readonly payer: Payer;
}

export interface ParentalEntitlement {
  /** `GPML`, `EA_MATERNITY`, `GPPL`, `SPL`, `GPAL`; null when nothing applies. */
  readonly scheme: string | null;
  readonly eligible: boolean;
  /** Why not eligible, or conditions to check, in plain English. */
  readonly reasons: readonly string[];
  /** 0 when not eligible. */
  readonly weeks: number;
  /** weeks × paid working days per week; multiples of 0.5. */
  readonly workingDays: number;
  /** Covers 1..workingDays. */
  readonly funding: readonly FundingSegment[];
  readonly governmentCapCents: number | null;
  readonly perWeekCapCents: number | null;
  /** The date that picked the rule row (birth, EDD or formal intent to adopt). */
  readonly referenceDate: IsoDate | null;
  readonly working: readonly WorkingStep[];
  readonly source: string;
}

export function assertWorkingDaysPerWeek(value: number, field = "workingDaysPerWeek"): void {
  if (!(value > 0 && value <= 7) || !Number.isInteger(value * 2)) {
    throw new SgRulesInputError(`${field} must be a multiple of 0.5 between 0.5 and 7, got ${value}.`);
  }
}

function assertBirthOrder(order: number): void {
  if (!Number.isInteger(order) || order < 1) {
    throw new SgRulesInputError(`birthOrder must be a whole number from 1, got ${order}.`);
  }
}

function checkChild(child: ChildFacts): void {
  assertBirthOrder(child.birthOrder);
  if (child.birthDate) parseDate(child.birthDate, "child.birthDate");
  if (child.expectedDeliveryDate) parseDate(child.expectedDeliveryDate, "child.expectedDeliveryDate");
  if (child.adoptionIntentDate) parseDate(child.adoptionIntentDate, "child.adoptionIntentDate");
}

/** Completed months of continuous service before `ref` (the day before counts). */
export function serviceMonthsBefore(employmentStartDate: IsoDate, ref: IsoDate): number {
  parseDate(employmentStartDate, "employmentStartDate");
  return completedMonths(employmentStartDate, addDays(ref, -1));
}

function notEligible(
  scheme: string | null,
  reasons: string[],
  referenceDate: IsoDate | null,
  source: string,
  working: WorkingStep[] = [],
): ParentalEntitlement {
  return {
    scheme,
    eligible: false,
    reasons,
    weeks: 0,
    workingDays: 0,
    funding: [],
    governmentCapCents: null,
    perWeekCapCents: null,
    referenceDate,
    working: [...working, { code: "LEAVE_NOT_ELIGIBLE", text: reasons.join(" ") }],
    source,
  };
}

function fundingRuleFor(rules: readonly FundingRule[], birthOrder: number): FundingRule {
  return [...rules].reverse().find((r) => birthOrder >= r.fromBirthOrder) as FundingRule;
}

/** Segments for `weeks` weeks: employer weeks first, then unpaid weeks, then Government-paid. */
function weekSegments(weeks: number, daysPerWeek: number, rule: Pick<FundingRule, "employerWeeks" | "unpaidWeeks">) {
  const segments: FundingSegment[] = [];
  let day = 0;
  const push = (w: number, payer: Payer) => {
    if (w <= 0) return;
    const len = w * daysPerWeek;
    segments.push({ fromDay: day + 1, toDay: day + len, payer });
    day += len;
  };
  const employer = Math.min(rule.employerWeeks, weeks);
  const unpaid = Math.min(rule.unpaidWeeks, weeks - employer);
  push(employer, "employer");
  push(unpaid, "unpaid");
  push(weeks - employer - unpaid, "government");
  return segments;
}

function serviceStep(months: number, ref: IsoDate, label: string): WorkingStep {
  return {
    code: "LEAVE_SERVICE",
    text: `${months} completed months of service before ${label} (${dateLabel(ref)}).`,
  };
}

const birthRef = (child: ChildFacts): IsoDate | null => child.birthDate ?? child.expectedDeliveryDate ?? null;

/**
 * Maternity leave. Singapore Citizen child: Government-Paid Maternity Leave, 16 weeks, needing 3
 * continuous months of service before the birth (no marriage requirement); for the 1st and 2nd child
 * the employer pays weeks 1–8 and the Government reimburses weeks 9–16 (cap $10,000 per 4 weeks,
 * $20,000 in all); from the 3rd child all 16 weeks are reimbursed (cap $40,000). Otherwise Employment
 * Act maternity leave, 12 weeks: employer-paid weeks 1–8 for a mother with fewer than 2 living
 * children, the rest unpaid.
 */
export function maternityLeave(input: {
  readonly child: ChildFacts;
  readonly employmentStartDate: IsoDate;
  readonly workingDaysPerWeek: number;
}): ParentalEntitlement {
  assertWorkingDaysPerWeek(input.workingDaysPerWeek);
  checkChild(input.child);
  const ref = birthRef(input.child);
  if (!ref) {
    return notEligible(null, ["Enter the child's birth date or expected delivery date."], null, SOURCES.maternity);
  }
  const rule = pickInForce(input.child.isCitizen ? GPML_RULES : EA_MATERNITY_RULES, ref, "maternity leave");
  const months = serviceMonthsBefore(input.employmentStartDate, ref);
  const working: WorkingStep[] = [serviceStep(months, ref, input.child.birthDate ? "the birth" : "the due date")];
  if (months < rule.minServiceMonths) {
    return notEligible(
      rule.scheme,
      [
        `Maternity leave needs ${rule.minServiceMonths} continuous months of service before the birth; there are ${months}. Check the hire date.`,
      ],
      ref,
      rule.source,
      working,
    );
  }
  const funding = fundingRuleFor(rule.funding, input.child.birthOrder);
  const workingDays = rule.weeks * input.workingDaysPerWeek;
  const segments = weekSegments(rule.weeks, input.workingDaysPerWeek, funding);
  const reasons =
    rule.scheme === "GPML"
      ? ["Give 4 weeks' notice; without notice only half pay is due unless there is a good reason."]
      : ["The child is not a Singapore Citizen, so Employment Act maternity leave (12 weeks) applies."];
  working.push({
    code: "LEAVE_MATERNITY",
    text:
      rule.scheme === "GPML"
        ? `Government-Paid Maternity Leave: 16 weeks × ${input.workingDaysPerWeek} days = ${workingDays} working days; child ${input.child.birthOrder} → ${funding.employerWeeks ? "employer pays weeks 1–8, Government reimburses weeks 9–16" : "Government reimburses all 16 weeks"} (cap ${money(funding.governmentCapCents ?? 0)}).`
        : `Employment Act maternity leave: 12 weeks × ${input.workingDaysPerWeek} days = ${workingDays} working days; ${funding.employerWeeks ? "employer pays weeks 1–8, weeks 9–12 unpaid" : "unpaid (the mother already has 2 or more children)"}.`,
  });
  return {
    scheme: rule.scheme,
    eligible: true,
    reasons,
    weeks: rule.weeks,
    workingDays,
    funding: segments,
    governmentCapCents: funding.governmentCapCents,
    perWeekCapCents: rule.perWeekCapCents,
    referenceDate: ref,
    working,
    source: rule.source,
  };
}

/**
 * Government-Paid Paternity Leave. Singapore Citizen child, father married to the mother (between
 * conception and birth, or within 12 months after), 3 months' service. 2 weeks before 1 Jan 2024;
 * 2 + 2 voluntary weeks (employer agreement) from 1 Jan 2024; 4 weeks from 1 Apr 2025; 2 weeks for a
 * stillborn child. All reimbursed, capped at $2,500 a week; paid days capped at 6 a week.
 */
export function paternityLeave(input: {
  readonly child: ChildFacts;
  readonly employmentStartDate: IsoDate;
  readonly workingDaysPerWeek: number;
  readonly marriedToMother: boolean;
}): ParentalEntitlement {
  assertWorkingDaysPerWeek(input.workingDaysPerWeek);
  checkChild(input.child);
  const ref = birthRef(input.child) ?? input.child.adoptionIntentDate ?? null;
  if (!ref) {
    return notEligible(
      "GPPL",
      ["Enter the child's birth date, expected delivery date or the formal intent to adopt."],
      null,
      SOURCES.paternity,
    );
  }
  const rule = pickInForce(PATERNITY_RULES, ref, "paternity leave");
  const reasons: string[] = [];
  if (!input.child.isCitizen)
    reasons.push("Paternity leave needs the child to be a Singapore Citizen. Check the child's citizenship.");
  if (!input.marriedToMother)
    reasons.push(
      "Paternity leave needs the father to be (or have been) married to the mother between conception and birth, or within 12 months after.",
    );
  const months = serviceMonthsBefore(input.employmentStartDate, ref);
  const working: WorkingStep[] = [serviceStep(months, ref, "the birth")];
  if (months < rule.minServiceMonths)
    reasons.push(`Paternity leave needs ${rule.minServiceMonths} months of service; there are ${months}.`);
  if (reasons.length) return notEligible("GPPL", reasons, ref, rule.source, working);

  const stillborn = input.child.stillborn === true;
  const weeks = stillborn ? PATERNITY_STILLBIRTH_WEEKS.weeks : rule.weeks;
  const perWeek = Math.min(input.workingDaysPerWeek, rule.maxDaysPerWeek);
  const workingDays = weeks * perWeek;
  const notes: string[] = [];
  if (stillborn) notes.push("Stillbirth: 2 weeks of paternity leave.");
  else if (rule.voluntaryWeeks)
    notes.push(
      `Weeks ${weeks - rule.voluntaryWeeks + 1}–${weeks} are voluntary: they need the employer's agreement (still Government-reimbursed).`,
    );
  notes.push("Give 4 weeks' notice where possible.");
  working.push({
    code: "LEAVE_PATERNITY",
    text: `Paternity leave for ${ref < "2025-04-01" ? "a child before 1 Apr 2025" : "a child from 1 Apr 2025"}${stillborn ? " (stillbirth)" : ""}: ${weeks} weeks × ${perWeek} days = ${workingDays} working days, all Government-reimbursed (cap ${money(rule.perWeekCapCents)} a week).`,
  });
  return {
    scheme: "GPPL",
    eligible: true,
    reasons: notes,
    weeks,
    workingDays,
    funding: [{ fromDay: 1, toDay: workingDays, payer: "government" }],
    governmentCapCents: rule.perWeekCapCents * weeks,
    perWeekCapCents: rule.perWeekCapCents,
    referenceDate: ref,
    working,
    source: stillborn ? PATERNITY_STILLBIRTH_WEEKS.source : rule.source,
  };
}

/**
 * Shared Parental Leave: 6 weeks for children born (or with EDD or adoption intent) from 1 Apr 2025,
 * 10 weeks from 1 Apr 2026 (birth OR EDD on/after). Shared between the parents; stillborn children
 * do not qualify. Government-reimbursed, $2,500 a week.
 */
export function sharedParentalLeave(input: {
  readonly child: ChildFacts;
  readonly employmentStartDate: IsoDate;
  readonly workingDaysPerWeek: number;
  readonly parent: "mother" | "father";
  readonly marriedToMother?: boolean;
}): ParentalEntitlement {
  assertWorkingDaysPerWeek(input.workingDaysPerWeek);
  checkChild(input.child);
  const dates = [input.child.birthDate, input.child.expectedDeliveryDate].filter((d): d is IsoDate => !!d);
  const ref = dates.length ? (dates.sort().at(-1) as IsoDate) : (input.child.adoptionIntentDate ?? null);
  if (!ref) {
    return notEligible(
      "SPL",
      ["Enter the child's birth date, expected delivery date or the formal intent to adopt."],
      null,
      SOURCES.sharedParental,
    );
  }
  if (input.child.stillborn) {
    return notEligible(
      "SPL",
      ["Stillborn children do not qualify for Shared Parental Leave."],
      ref,
      SOURCES.sharedParentalStillbirth,
    );
  }
  const rule = SHARED_PARENTAL_RULES.find(
    (r) => r.effectiveFrom <= ref && (r.effectiveTo === null || ref < r.effectiveTo),
  );
  if (!rule) {
    return notEligible(
      "SPL",
      [
        `Shared Parental Leave is for children born from 1 Apr 2025; the earlier scheme is not encoded (${dateLabel(ref)}).`,
      ],
      ref,
      SOURCES.sharedParental,
    );
  }
  const reasons: string[] = [];
  if (!input.child.isCitizen) reasons.push("Shared Parental Leave needs the child to be a Singapore Citizen.");
  if (input.parent === "father" && !input.marriedToMother)
    reasons.push("For the father, Shared Parental Leave needs the same marriage condition as paternity leave.");
  const months = serviceMonthsBefore(input.employmentStartDate, ref);
  const working: WorkingStep[] = [serviceStep(months, ref, "the birth")];
  if (months < rule.minServiceMonths)
    reasons.push(`Shared Parental Leave needs ${rule.minServiceMonths} months of service; there are ${months}.`);
  if (reasons.length) return notEligible("SPL", reasons, ref, rule.source, working);
  const workingDays = rule.weeks * input.workingDaysPerWeek;
  working.push({
    code: "LEAVE_SPL",
    text: `Shared Parental Leave: ${rule.weeks} weeks between both parents × ${input.workingDaysPerWeek} days = ${workingDays} working days, Government-reimbursed (cap ${money(rule.perWeekCapCents)} a week).`,
  });
  return {
    scheme: "SPL",
    eligible: true,
    reasons: [
      `The ${rule.weeks} weeks are shared between both parents: record only the share this parent takes.`,
      "Use maternity, paternity or adoption leave first; unused SPL is not encashed.",
    ],
    weeks: rule.weeks,
    workingDays,
    funding: [{ fromDay: 1, toDay: workingDays, payer: "government" }],
    governmentCapCents: rule.perWeekCapCents * rule.weeks,
    perWeekCapCents: rule.perWeekCapCents,
    referenceDate: ref,
    working,
    source: rule.source,
  };
}

/**
 * Government-Paid Adoption Leave: 12 weeks for the adoptive mother; the child is under 12 months at
 * the formal intent to adopt and is (or becomes) a Singapore Citizen; 3 months' service. 1st/2nd
 * child: employer weeks 1–4, Government weeks 5–12 (cap $20,000); 3rd+: all reimbursed (cap $30,000).
 */
export function adoptionLeave(input: {
  readonly child: ChildFacts;
  readonly employmentStartDate: IsoDate;
  readonly workingDaysPerWeek: number;
}): ParentalEntitlement {
  assertWorkingDaysPerWeek(input.workingDaysPerWeek);
  checkChild(input.child);
  const ref = input.child.adoptionIntentDate ?? null;
  if (!ref) {
    return notEligible("GPAL", ["Enter the date of the formal intent to adopt."], null, SOURCES.adoption);
  }
  const rule = pickInForce(ADOPTION_RULES, ref, "adoption leave");
  const reasons: string[] = [];
  if (!input.child.birthDate) reasons.push("Enter the child's date of birth to check the age condition.");
  // Age in whole months on the intent date (the birthday itself starts the next month of age).
  else if (completedMonths(input.child.birthDate, addDays(ref, -1)) >= rule.maxChildAgeMonths)
    reasons.push(
      `Adoption leave needs the child to be under ${rule.maxChildAgeMonths} months old at the formal intent to adopt.`,
    );
  if (!input.child.isCitizen) reasons.push("Adoption leave needs the child to be (or become) a Singapore Citizen.");
  const months = serviceMonthsBefore(input.employmentStartDate, ref);
  const working: WorkingStep[] = [serviceStep(months, ref, "the formal intent to adopt")];
  if (months < rule.minServiceMonths)
    reasons.push(`Adoption leave needs ${rule.minServiceMonths} months of service; there are ${months}.`);
  if (reasons.length) return notEligible("GPAL", reasons, ref, rule.source, working);
  const funding = fundingRuleFor(rule.funding, input.child.birthOrder);
  const workingDays = rule.weeks * input.workingDaysPerWeek;
  working.push({
    code: "LEAVE_ADOPTION",
    text: `Adoption leave: 12 weeks × ${input.workingDaysPerWeek} days = ${workingDays} working days; ${funding.employerWeeks ? "employer pays weeks 1–4, Government reimburses weeks 5–12" : "Government reimburses all 12 weeks"} (cap ${money(funding.governmentCapCents ?? 0)}).`,
  });
  return {
    scheme: "GPAL",
    eligible: true,
    reasons: [],
    weeks: rule.weeks,
    workingDays,
    funding: weekSegments(rule.weeks, input.workingDaysPerWeek, funding),
    governmentCapCents: funding.governmentCapCents,
    perWeekCapCents: rule.perWeekCapCents,
    referenceDate: ref,
    working,
    source: rule.source,
  };
}

/**
 * Who pays working day `day` of an entitlement: 1-based, so day 1 is the first working day. A
 * cumulative half-day count may be passed (0.5 and 1 are both day 1). Throws outside (0, max].
 */
export function fundingForDay(segments: readonly FundingSegment[], day: number): Payer {
  const max = segments.at(-1)?.toDay ?? 0;
  if (!(day > 0 && day <= max)) {
    throw new SgRulesInputError(`day must be between 1 and ${max}, got ${day}.`);
  }
  return (segments.find((s) => day <= s.toDay) as FundingSegment).payer;
}
