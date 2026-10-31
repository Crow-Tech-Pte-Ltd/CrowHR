import { SgRulesInputError } from "../errors.ts";
import { completedMonths, parseDate } from "../internal/dates.ts";
import { pickInForce } from "../tables/effective.ts";
import type { IsoDate, WorkingStep } from "../types.ts";
import type { ChildFacts, FundingSegment } from "./parental.ts";
import { CHILDCARE_RULES, INFANT_CARE_LIFETIME_DAYS_PER_CHILD, INFANT_CARE_RULES } from "./tables.ts";

export interface ChildcareInput {
  readonly children: readonly ChildFacts[];
  /** Calendar leave year. */
  readonly year: number;
  readonly employmentStartDate: IsoDate;
  /** Service is counted to this date (pro-ration for new hires). */
  readonly asOfDate: IsoDate;
}

export interface ChildcareResult {
  /** Government-Paid Childcare Leave (Singapore Citizen child under 7), after pro-ration. */
  readonly gpclDays: number;
  /** Employment Act childcare leave (non-citizen child under 7). */
  readonly eaChildcareDays: number;
  /** Extended childcare leave (Singapore Citizen child aged 7–12, none under 7). */
  readonly eclDays: number;
  readonly funding: {
    readonly gpcl: readonly FundingSegment[];
    readonly ecl: readonly FundingSegment[];
    readonly ea: readonly FundingSegment[];
  };
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly working: readonly WorkingStep[];
  readonly source: string;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1900 || year > 9999)
    throw new SgRulesInputError(`year must be a 4-digit year, got ${year}.`);
}

/** Age in whole years on 1 Jan of `year`; a child born during the year is 0; null if not yet born. */
export function ageAtStartOfYear(child: ChildFacts, year: number): number | null {
  if (!child.birthDate || child.stillborn) return null;
  const { y, m, d } = parseDate(child.birthDate, "child.birthDate");
  if (y > year) return null;
  if (y === year) return 0;
  // Born on 1 Jan: a full year more.
  return year - y - (m === 1 && d === 1 ? 0 : 1);
}

function segment(from: number, to: number, payer: FundingSegment["payer"]): FundingSegment[] {
  return to >= from ? [{ fromDay: from, toDay: to, payer }] : [];
}

/**
 * Childcare leave for one parent and one calendar year (ages assessed at 1 Jan of the year).
 * - GPCL: 6 days if any Singapore Citizen child is under 7, pro-rated for employees with less than
 *   12 completed months of service (MOM table). The employer pays days 1–3; days 4–6 are reimbursed
 *   at up to $500 a day including CPF.
 * - Extended childcare leave: 2 days, fully reimbursed, if a Singapore Citizen child is aged 7–12 and
 *   none is under 7 (at most 6 days a year across both). Not pro-rated.
 * - Employment Act childcare: 2 days, employer-paid, if a non-citizen child is under 7 and no citizen
 *   child is. Not pro-rated.
 * All need 3 months of service. No carry forward, no encashment.
 */
export function childcareLeave(input: ChildcareInput): ChildcareResult {
  assertYear(input.year);
  parseDate(input.employmentStartDate, "employmentStartDate");
  parseDate(input.asOfDate, "asOfDate");
  const rule = pickInForce(CHILDCARE_RULES, `${input.year}-01-01`, "childcare leave");
  const months = completedMonths(input.employmentStartDate, input.asOfDate);
  const ages = input.children.map((c) => ({ c, age: ageAtStartOfYear(c, input.year) }));
  const citizenUnder7 = ages.some((a) => a.c.isCitizen && a.age !== null && a.age < rule.gpclMaxAge);
  const citizen7to12 = ages.some(
    (a) => a.c.isCitizen && a.age !== null && a.age >= rule.eclMinAge && a.age <= rule.eclMaxAge,
  );
  const foreignUnder7 = ages.some((a) => !a.c.isCitizen && a.age !== null && a.age < rule.gpclMaxAge);
  const working: WorkingStep[] = [
    {
      code: "LEAVE_CHILDCARE_CHILDREN",
      text: `Children's ages on 1 Jan ${input.year}: ${ages.map((a) => (a.age === null ? "not born" : `${a.age}${a.c.isCitizen ? " (SC)" : ""}`)).join(", ") || "none"}; ${months} completed months of service.`,
    },
  ];
  const empty = (reasons: string[]): ChildcareResult => ({
    gpclDays: 0,
    eaChildcareDays: 0,
    eclDays: 0,
    funding: { gpcl: [], ecl: [], ea: [] },
    eligible: false,
    reasons,
    working,
    source: rule.source,
  });
  if (!citizenUnder7 && !citizen7to12 && !foreignUnder7) {
    return empty([
      "Childcare leave needs a child under 7 (extended childcare: a Singapore Citizen child aged 7–12). Add the child's details.",
    ]);
  }
  if (months < rule.minServiceMonths) {
    return empty([`Childcare leave needs ${rule.minServiceMonths} months of service; there are ${months}.`]);
  }
  let gpclDays = 0;
  let eclDays = 0;
  let eaChildcareDays = 0;
  if (citizenUnder7) {
    gpclDays = months < 12 ? (rule.gpclProrated[months] as number) : rule.gpclDays;
    working.push({
      code: "LEAVE_GPCL",
      text:
        months < 12
          ? `Government-Paid Childcare Leave pro-rated for ${months} completed months: ${gpclDays} days.`
          : `Government-Paid Childcare Leave: ${gpclDays} days.`,
    });
  } else if (citizen7to12) {
    eclDays = Math.min(rule.eclDays, rule.combinedMaxDays);
    working.push({ code: "LEAVE_ECL", text: `Extended childcare leave (youngest SC child 7–12): ${eclDays} days.` });
  }
  if (!citizenUnder7 && foreignUnder7) {
    eaChildcareDays = rule.eaDays;
    working.push({ code: "LEAVE_EA_CHILDCARE", text: `Employment Act childcare leave: ${eaChildcareDays} days.` });
  }
  return {
    gpclDays,
    eaChildcareDays,
    eclDays,
    funding: {
      gpcl: [
        ...segment(1, Math.min(gpclDays, rule.gpclEmployerDays), "employer"),
        ...segment(rule.gpclEmployerDays + 1, gpclDays, "government"),
      ],
      ecl: segment(1, eclDays, "government"),
      ea: segment(1, eaChildcareDays, "employer"),
    },
    eligible: true,
    reasons: ["No carry forward and no encashment. Government-paid days are reimbursed at up to $500 a day."],
    working,
    source: rule.source,
  };
}

export interface InfantCareResult {
  readonly days: number;
  readonly perChildLifetimeDays: number;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly working: readonly WorkingStep[];
  readonly source: string;
}

/**
 * Unpaid infant care leave: 12 days a year from 1 Jan 2024 (6 before), for a Singapore Citizen child
 * under 2 at some point in the year, after 3 months of service; at most 24 days per child.
 */
export function infantCareLeave(input: ChildcareInput): InfantCareResult {
  assertYear(input.year);
  parseDate(input.employmentStartDate, "employmentStartDate");
  parseDate(input.asOfDate, "asOfDate");
  const rule = pickInForce(INFANT_CARE_RULES, `${input.year}-01-01`, "unpaid infant care leave");
  const months = completedMonths(input.employmentStartDate, input.asOfDate);
  const hasInfant = input.children.some((c) => {
    const age = ageAtStartOfYear(c, input.year);
    return c.isCitizen && age !== null && age < rule.maxChildAge;
  });
  const reasons: string[] = [];
  if (!hasInfant)
    reasons.push("Unpaid infant care leave needs a Singapore Citizen child under 2. Add the child's details.");
  if (months < rule.minServiceMonths)
    reasons.push(`Unpaid infant care leave needs ${rule.minServiceMonths} months of service; there are ${months}.`);
  const eligible = reasons.length === 0;
  return {
    days: eligible ? rule.daysPerYear : 0,
    perChildLifetimeDays: INFANT_CARE_LIFETIME_DAYS_PER_CHILD,
    eligible,
    reasons: eligible ? ["Unpaid leave: deducted from salary as no-pay leave."] : reasons,
    working: [
      {
        code: "LEAVE_INFANT_CARE",
        text: eligible
          ? `Unpaid infant care leave ${input.year}: ${rule.daysPerYear} days (at most ${INFANT_CARE_LIFETIME_DAYS_PER_CHILD} per child).`
          : reasons.join(" "),
      },
    ],
    source: rule.source,
  };
}
