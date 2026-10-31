import { describe, expect, it } from "vitest";
import { RulesNotAvailableError, SgRulesInputError } from "../errors.ts";
import { effectiveRangeIssues } from "../tables/effective.ts";
import {
  adoptionLeave,
  type ChildFacts,
  fundingForDay,
  maternityLeave,
  paternityLeave,
  serviceMonthsBefore,
  sharedParentalLeave,
} from "./parental.ts";
import {
  ADOPTION_RULES,
  CHILDCARE_RULES,
  EA_MATERNITY_RULES,
  GPML_RULES,
  INFANT_CARE_RULES,
  NDR_2026_CHILDCARE,
  PATERNITY_RULES,
  SHARED_PARENTAL_RULES,
} from "./tables.ts";

const child = (over: Partial<ChildFacts> = {}): ChildFacts => ({
  birthDate: "2026-06-10",
  expectedDeliveryDate: null,
  isCitizen: true,
  birthOrder: 1,
  ...over,
});
const HIRED = "2020-01-06";

describe("leave rule data", () => {
  it("every family is cited, verified, non-overlapping and open-ended", () => {
    const families = {
      GPML_RULES,
      EA_MATERNITY_RULES,
      PATERNITY_RULES,
      SHARED_PARENTAL_RULES,
      ADOPTION_RULES,
      CHILDCARE_RULES,
      INFANT_CARE_RULES,
    };
    for (const [family, rows] of Object.entries(families)) {
      const issues = effectiveRangeIssues(family, rows).filter((i) => !/after coverage start/.test(i.problem));
      expect(issues, family).toEqual([]);
      for (const r of rows) expect(r.verifiedOn).toBe("2026-10-31");
    }
    // SPL genuinely starts on 1 Apr 2025: earlier children are reported as not encoded.
    expect(SHARED_PARENTAL_RULES[0]?.effectiveFrom).toBe("2025-04-01");
  });

  it("the NDR 2026 childcare change is data only, with no effective date", () => {
    expect(NDR_2026_CHILDCARE.effectiveFrom).toBeNull();
    expect(NDR_2026_CHILDCARE.citizenChildrenOnly).toBe(true);
    expect(NDR_2026_CHILDCARE.daysByChildCount.map((r) => r.days)).toEqual([8, 10, 12]);
  });
});

describe("maternity leave", () => {
  it("GPML 1st child: employer weeks 1–8, Government weeks 9–16, cap $20,000", () => {
    const r = maternityLeave({ child: child(), employmentStartDate: HIRED, workingDaysPerWeek: 5 });
    expect(r).toMatchObject({
      scheme: "GPML",
      eligible: true,
      weeks: 16,
      workingDays: 80,
      governmentCapCents: 2_000_000,
      perWeekCapCents: 250_000,
      referenceDate: "2026-06-10",
    });
    expect(r.funding).toEqual([
      { fromDay: 1, toDay: 40, payer: "employer" },
      { fromDay: 41, toDay: 80, payer: "government" },
    ]);
    expect(fundingForDay(r.funding, 40)).toBe("employer");
    expect(fundingForDay(r.funding, 40.5)).toBe("government");
    expect(fundingForDay(r.funding, 0.5)).toBe("employer");
  });

  it("GPML 3rd child: all 16 weeks Government-paid, cap $40,000; 5.5-day week", () => {
    const r = maternityLeave({ child: child({ birthOrder: 3 }), employmentStartDate: HIRED, workingDaysPerWeek: 5.5 });
    expect(r.workingDays).toBe(88);
    expect(r.governmentCapCents).toBe(4_000_000);
    expect(r.funding).toEqual([{ fromDay: 1, toDay: 88, payer: "government" }]);
  });

  it("uses the expected delivery date before the birth", () => {
    const r = maternityLeave({
      child: child({ birthDate: null, expectedDeliveryDate: "2026-12-01" }),
      employmentStartDate: "2026-08-15",
      workingDaysPerWeek: 5,
    });
    expect(r.referenceDate).toBe("2026-12-01");
    expect(r.eligible).toBe(true);
  });

  it("needs 3 continuous months before the birth", () => {
    expect(serviceMonthsBefore("2026-03-10", "2026-06-10")).toBe(3);
    expect(serviceMonthsBefore("2026-03-11", "2026-06-10")).toBe(2);
    const r = maternityLeave({ child: child(), employmentStartDate: "2026-03-11", workingDaysPerWeek: 5 });
    expect(r.eligible).toBe(false);
    expect(r.workingDays).toBe(0);
    expect(r.reasons[0]).toMatch(/3 continuous months/);
  });

  it("EA maternity for a non-citizen child: employer weeks 1–8, unpaid 9–12; unpaid from the 3rd child", () => {
    const r = maternityLeave({ child: child({ isCitizen: false }), employmentStartDate: HIRED, workingDaysPerWeek: 5 });
    expect(r).toMatchObject({ scheme: "EA_MATERNITY", weeks: 12, workingDays: 60, governmentCapCents: null });
    expect(r.funding).toEqual([
      { fromDay: 1, toDay: 40, payer: "employer" },
      { fromDay: 41, toDay: 60, payer: "unpaid" },
    ]);
    const third = maternityLeave({
      child: child({ isCitizen: false, birthOrder: 3 }),
      employmentStartDate: HIRED,
      workingDaysPerWeek: 5,
    });
    expect(third.funding).toEqual([{ fromDay: 1, toDay: 60, payer: "unpaid" }]);
  });

  it("asks for a date when there is none, and refuses dates before the encoded rules", () => {
    expect(
      maternityLeave({
        child: child({ birthDate: null }),
        employmentStartDate: HIRED,
        workingDaysPerWeek: 5,
      }).reasons[0],
    ).toMatch(/birth date or expected delivery date/);
    expect(() =>
      maternityLeave({ child: child({ birthDate: "2024-06-01" }), employmentStartDate: HIRED, workingDaysPerWeek: 5 }),
    ).toThrow(RulesNotAvailableError);
  });

  it("validates inputs", () => {
    const base = { child: child(), employmentStartDate: HIRED };
    expect(() => maternityLeave({ ...base, workingDaysPerWeek: 0 })).toThrow(SgRulesInputError);
    expect(() => maternityLeave({ ...base, workingDaysPerWeek: 5.25 })).toThrow(SgRulesInputError);
    expect(() => maternityLeave({ ...base, workingDaysPerWeek: 8 })).toThrow(SgRulesInputError);
    expect(() =>
      maternityLeave({ child: child({ birthOrder: 0 }), employmentStartDate: HIRED, workingDaysPerWeek: 5 }),
    ).toThrow(/birthOrder/);
    expect(() =>
      maternityLeave({ child: child({ birthDate: "2026-02-30" }), employmentStartDate: HIRED, workingDaysPerWeek: 5 }),
    ).toThrow(SgRulesInputError);
    expect(() =>
      maternityLeave({
        child: child({ expectedDeliveryDate: "bad" }),
        employmentStartDate: HIRED,
        workingDaysPerWeek: 5,
      }),
    ).toThrow(SgRulesInputError);
    expect(() =>
      maternityLeave({
        child: child({ adoptionIntentDate: "2026-13-01" }),
        employmentStartDate: HIRED,
        workingDaysPerWeek: 5,
      }),
    ).toThrow(SgRulesInputError);
    expect(() => maternityLeave({ ...base, employmentStartDate: "x", workingDaysPerWeek: 5 })).toThrow(
      SgRulesInputError,
    );
  });
});

describe("paternity leave", () => {
  const pat = (c: Partial<ChildFacts>, over: { workingDaysPerWeek?: number; marriedToMother?: boolean } = {}) =>
    paternityLeave({
      child: child(c),
      employmentStartDate: HIRED,
      workingDaysPerWeek: over.workingDaysPerWeek ?? 5,
      marriedToMother: over.marriedToMother ?? true,
    });

  it("2 weeks before 1 Jan 2024", () => {
    const r = pat({ birthDate: "2023-12-31" });
    expect(r).toMatchObject({ scheme: "GPPL", eligible: true, weeks: 2, workingDays: 10 });
    expect(r.reasons.join(" ")).not.toMatch(/voluntary/);
  });

  it("from 1 Jan 2024: 2 + 2 voluntary weeks needing the employer's agreement", () => {
    const r = pat({ birthDate: "2024-01-01" });
    expect(r.weeks).toBe(4);
    expect(r.reasons[0]).toMatch(/Weeks 3–4 are voluntary/);
    expect(pat({ birthDate: "2025-03-31" }).reasons[0]).toMatch(/voluntary/);
  });

  it("from 1 Apr 2025: 4 mandatory weeks, all Government-reimbursed at $2,500 a week", () => {
    const r = pat({ birthDate: "2025-04-01" });
    expect(r).toMatchObject({ weeks: 4, workingDays: 20, governmentCapCents: 1_000_000, perWeekCapCents: 250_000 });
    expect(r.reasons.join(" ")).not.toMatch(/voluntary/);
    expect(r.funding).toEqual([{ fromDay: 1, toDay: 20, payer: "government" }]);
  });

  it("a stillborn child gives 2 weeks", () => {
    const r = pat({ birthDate: "2026-06-10", stillborn: true });
    expect(r).toMatchObject({ eligible: true, weeks: 2, workingDays: 10 });
    expect(r.reasons[0]).toMatch(/Stillbirth/);
    expect(r.source).toMatch(/ask\.gov\.sg/);
  });

  it("paid days are capped at 6 a week", () => {
    expect(pat({}, { workingDaysPerWeek: 7 }).workingDays).toBe(24);
    expect(pat({}, { workingDaysPerWeek: 5.5 }).workingDays).toBe(22);
  });

  it("uses EDD, then the adoption intent date", () => {
    expect(pat({ birthDate: null, expectedDeliveryDate: "2025-03-31" }).referenceDate).toBe("2025-03-31");
    expect(pat({ birthDate: null, adoptionIntentDate: "2025-05-01" }).weeks).toBe(4);
    expect(pat({ birthDate: null }).reasons[0]).toMatch(/Enter the child's birth date/);
  });

  it("checks citizenship, marriage and service", () => {
    const r = pat({ isCitizen: false }, { marriedToMother: false });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toHaveLength(2);
    const fresh = paternityLeave({
      child: child(),
      employmentStartDate: "2026-04-01",
      workingDaysPerWeek: 5,
      marriedToMother: true,
    });
    expect(fresh.reasons[0]).toMatch(/3 months of service; there are 2/);
  });
});

describe("shared parental leave", () => {
  const spl = (c: Partial<ChildFacts>, over: Partial<Parameters<typeof sharedParentalLeave>[0]> = {}) =>
    sharedParentalLeave({
      child: child(c),
      employmentStartDate: HIRED,
      workingDaysPerWeek: 5,
      parent: "mother",
      ...over,
    });

  it("6 weeks to 31 Mar 2026, 10 weeks from 1 Apr 2026", () => {
    expect(spl({ birthDate: "2026-03-31" })).toMatchObject({ eligible: true, weeks: 6, workingDays: 30 });
    expect(spl({ birthDate: "2026-04-01" })).toMatchObject({ eligible: true, weeks: 10, workingDays: 50 });
    expect(spl({ birthDate: "2026-04-01" }).reasons[0]).toMatch(/shared between both parents/);
  });

  it("an EDD on or after 1 Apr 2026 keeps 10 weeks when the child arrives earlier", () => {
    const r = spl({ birthDate: "2026-03-25", expectedDeliveryDate: "2026-04-05" });
    expect(r.weeks).toBe(10);
    expect(r.referenceDate).toBe("2026-04-05");
  });

  it("stillborn children are excluded", () => {
    const r = spl({ birthDate: "2026-06-10", stillborn: true });
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/Stillborn children do not qualify/);
  });

  it("children before 1 Apr 2025 are not encoded; missing dates are asked for", () => {
    expect(spl({ birthDate: "2025-03-31" }).reasons[0]).toMatch(/not encoded/);
    expect(spl({ birthDate: null }).reasons[0]).toMatch(/Enter the child's birth date/);
    expect(spl({ birthDate: null, adoptionIntentDate: "2026-05-01" }).weeks).toBe(10);
  });

  it("father needs the marriage condition; citizenship and service apply", () => {
    expect(spl({}, { parent: "father" }).eligible).toBe(false);
    expect(spl({}, { parent: "father", marriedToMother: true }).eligible).toBe(true);
    expect(spl({ isCitizen: false }).reasons[0]).toMatch(/Singapore Citizen/);
    expect(spl({}, { employmentStartDate: "2026-05-01" }).reasons[0]).toMatch(/months of service/);
  });
});

describe("adoption leave", () => {
  const adopt = (c: Partial<ChildFacts>, start = HIRED) =>
    adoptionLeave({
      child: child({ birthDate: "2026-02-01", adoptionIntentDate: "2026-09-01", ...c }),
      employmentStartDate: start,
      workingDaysPerWeek: 5,
    });

  it("12 weeks; 1st/2nd child employer weeks 1–4, Government 5–12 (cap $20,000)", () => {
    const r = adopt({});
    expect(r).toMatchObject({
      scheme: "GPAL",
      eligible: true,
      weeks: 12,
      workingDays: 60,
      governmentCapCents: 2_000_000,
    });
    expect(r.funding).toEqual([
      { fromDay: 1, toDay: 20, payer: "employer" },
      { fromDay: 21, toDay: 60, payer: "government" },
    ]);
  });

  it("3rd child: all reimbursed, cap $30,000", () => {
    const r = adopt({ birthOrder: 3 });
    expect(r.governmentCapCents).toBe(3_000_000);
    expect(r.funding).toEqual([{ fromDay: 1, toDay: 60, payer: "government" }]);
  });

  it("the child must be under 12 months at the formal intent to adopt", () => {
    expect(adopt({ birthDate: "2025-09-02" }).eligible).toBe(true);
    const r = adopt({ birthDate: "2025-09-01" });
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/under 12 months/);
  });

  it("asks for the intent date and birth date; checks citizenship and service", () => {
    expect(adopt({ adoptionIntentDate: null }).reasons[0]).toMatch(/formal intent to adopt/);
    expect(adopt({ birthDate: null }).reasons[0]).toMatch(/date of birth/);
    expect(adopt({ isCitizen: false }).reasons[0]).toMatch(/Singapore Citizen/);
    expect(adopt({}, "2026-07-01").reasons[0]).toMatch(/months of service/);
  });
});

describe("fundingForDay", () => {
  it("throws outside the entitlement", () => {
    const segs = [{ fromDay: 1, toDay: 10, payer: "government" as const }];
    expect(() => fundingForDay(segs, 0)).toThrow(SgRulesInputError);
    expect(() => fundingForDay(segs, 10.5)).toThrow(SgRulesInputError);
    expect(() => fundingForDay([], 1)).toThrow(SgRulesInputError);
    expect(fundingForDay(segs, 10)).toBe("government");
  });
});
