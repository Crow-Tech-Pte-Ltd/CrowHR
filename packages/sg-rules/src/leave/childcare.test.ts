import { describe, expect, it } from "vitest";
import { RulesNotAvailableError, SgRulesInputError } from "../errors.ts";
import { ageAtStartOfYear, childcareLeave, infantCareLeave } from "./childcare.ts";
import type { ChildFacts } from "./parental.ts";
import { partTimeLeaveHours } from "./part-time.ts";

const kid = (birthDate: string | null, isCitizen = true, over: Partial<ChildFacts> = {}): ChildFacts => ({
  birthDate,
  expectedDeliveryDate: null,
  isCitizen,
  birthOrder: 1,
  ...over,
});
const base = { year: 2026, employmentStartDate: "2020-01-06", asOfDate: "2026-10-31" };

describe("ageAtStartOfYear", () => {
  it("ages on 1 Jan; born in the year is 0; unborn and stillborn are null", () => {
    expect(ageAtStartOfYear(kid("2020-03-05"), 2027)).toBe(6);
    expect(ageAtStartOfYear(kid("2020-01-01"), 2027)).toBe(7);
    expect(ageAtStartOfYear(kid("2026-08-01"), 2026)).toBe(0);
    expect(ageAtStartOfYear(kid("2027-02-01"), 2026)).toBeNull();
    expect(ageAtStartOfYear(kid(null), 2026)).toBeNull();
    expect(ageAtStartOfYear(kid("2026-01-01", true, { stillborn: true }), 2026)).toBeNull();
  });
});

describe("childcare leave", () => {
  it("GPCL 6 days for a citizen child under 7: employer days 1–3, Government 4–6", () => {
    const r = childcareLeave({ ...base, children: [kid("2022-05-01")] });
    expect(r).toMatchObject({ gpclDays: 6, eclDays: 0, eaChildcareDays: 0, eligible: true });
    expect(r.funding.gpcl).toEqual([
      { fromDay: 1, toDay: 3, payer: "employer" },
      { fromDay: 4, toDay: 6, payer: "government" },
    ]);
  });

  it("pro-rates GPCL for new hires by MOM's table (3→2 … 11→6, 12→6)", () => {
    const table: [string, number][] = [
      ["2026-07-31", 2],
      ["2026-06-30", 2],
      ["2026-05-31", 3],
      ["2026-04-30", 3],
      ["2026-03-31", 4],
      ["2026-02-28", 4],
      ["2026-01-31", 5],
      ["2025-12-31", 5],
      ["2025-11-30", 6],
      ["2025-10-31", 6],
    ];
    for (const [start, days] of table) {
      const r = childcareLeave({ ...base, employmentStartDate: start, children: [kid("2022-05-01")] });
      expect(r.gpclDays, start).toBe(days);
    }
    const two = childcareLeave({ ...base, employmentStartDate: "2026-07-31", children: [kid("2022-05-01")] });
    expect(two.funding.gpcl).toEqual([{ fromDay: 1, toDay: 2, payer: "employer" }]);
  });

  it("needs 3 months of service", () => {
    const r = childcareLeave({ ...base, employmentStartDate: "2026-08-15", children: [kid("2022-05-01")] });
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/3 months of service/);
  });

  it("extended childcare: 2 days, Government-paid, only when no citizen child is under 7", () => {
    const ecl = childcareLeave({ ...base, children: [kid("2017-03-01")] });
    expect(ecl).toMatchObject({ gpclDays: 0, eclDays: 2 });
    expect(ecl.funding.ecl).toEqual([{ fromDay: 1, toDay: 2, payer: "government" }]);
    // Combined cap: a child under 7 and one aged 7–12 → 6 days in all, not 8.
    const both = childcareLeave({ ...base, children: [kid("2017-03-01"), kid("2023-03-01")] });
    expect(both.gpclDays + both.eclDays).toBe(6);
    // ECL is not pro-rated.
    expect(childcareLeave({ ...base, employmentStartDate: "2026-07-01", children: [kid("2017-03-01")] }).eclDays).toBe(
      2,
    );
  });

  it("EA childcare 2 days for a non-citizen child under 7, employer-paid", () => {
    const r = childcareLeave({ ...base, children: [kid("2022-05-01", false)] });
    expect(r).toMatchObject({ gpclDays: 0, eaChildcareDays: 2 });
    expect(r.funding.ea).toEqual([{ fromDay: 1, toDay: 2, payer: "employer" }]);
    const mixed = childcareLeave({ ...base, children: [kid("2022-05-01", false), kid("2024-01-01")] });
    expect(mixed).toMatchObject({ gpclDays: 6, eaChildcareDays: 0 });
  });

  it("no qualifying child", () => {
    const r = childcareLeave({ ...base, children: [kid("2010-01-01"), kid(null)] });
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/child under 7/);
    expect(childcareLeave({ ...base, children: [] }).eligible).toBe(false);
  });

  it("validates the year and rejects years before the encoded rules", () => {
    expect(() => childcareLeave({ ...base, year: 26, children: [] })).toThrow(SgRulesInputError);
    expect(() => childcareLeave({ ...base, year: 2024, children: [] })).toThrow(RulesNotAvailableError);
  });
});

describe("unpaid infant care leave", () => {
  it("6 days in 2023, 12 days from 2024, citizen child under 2", () => {
    const c = [kid("2022-11-01")];
    expect(infantCareLeave({ ...base, year: 2023, asOfDate: "2023-06-30", children: c }).days).toBe(6);
    const r = infantCareLeave({ ...base, year: 2024, asOfDate: "2024-06-30", children: c });
    expect(r).toMatchObject({ days: 12, perChildLifetimeDays: 24, eligible: true });
  });

  it("child aged 2 on 1 Jan, non-citizen child, short service", () => {
    expect(infantCareLeave({ ...base, children: [kid("2024-01-01")] }).eligible).toBe(false);
    expect(infantCareLeave({ ...base, children: [kid("2026-03-01", false)] }).eligible).toBe(false);
    const fresh = infantCareLeave({ ...base, employmentStartDate: "2026-09-01", children: [kid("2026-03-01")] });
    expect(fresh.days).toBe(0);
    expect(fresh.reasons[0]).toMatch(/3 months of service/);
    expect(() => infantCareLeave({ ...base, year: 2022, children: [] })).toThrow(RulesNotAvailableError);
  });
});

describe("part-time leave in hours", () => {
  const mom = { partTimeHoursPerWeek: 20, fullTimeHoursPerWeek: 44, fullTimeHoursPerDay: 8 };
  it("reproduces MOM's examples: 25.5, 50.9 and 218.2 hours", () => {
    expect(partTimeLeaveHours({ ...mom, fullTimeEntitlementDays: 7 }).hours).toBe(25.5);
    expect(partTimeLeaveHours({ ...mom, fullTimeEntitlementDays: 14 }).hours).toBe(50.9);
    const hosp = partTimeLeaveHours({ ...mom, fullTimeEntitlementDays: 60 });
    expect(hosp.hours).toBe(218.2);
    expect(hosp.exactText).toContain("218.1818");
    expect(hosp.issues[0]?.code).toBe("PT_LEAVE_ROUNDING_UNVERIFIED");
  });

  it("uses the comparable full-timer's actual hours", () => {
    // 20 of 40 h a week, 14 days × 8 h = 56 h exactly.
    expect(
      partTimeLeaveHours({
        partTimeHoursPerWeek: 20,
        fullTimeHoursPerWeek: 40,
        fullTimeHoursPerDay: 8,
        fullTimeEntitlementDays: 14,
      }).hours,
    ).toBe(56);
    // 18.75 of 42.5 h, 7.5 days × 8.5 h = 28.125 → 28.1
    expect(
      partTimeLeaveHours({
        partTimeHoursPerWeek: 18.75,
        fullTimeHoursPerWeek: 42.5,
        fullTimeHoursPerDay: 8.5,
        fullTimeEntitlementDays: 7.5,
      }).hours,
    ).toBe(28.1);
  });

  it("validates inputs", () => {
    expect(() => partTimeLeaveHours({ ...mom, partTimeHoursPerWeek: 0, fullTimeEntitlementDays: 7 })).toThrow(
      SgRulesInputError,
    );
    expect(() => partTimeLeaveHours({ ...mom, fullTimeHoursPerDay: 8.1, fullTimeEntitlementDays: 7 })).toThrow(
      SgRulesInputError,
    );
    expect(() => partTimeLeaveHours({ ...mom, fullTimeEntitlementDays: 7.25 })).toThrow(SgRulesInputError);
    expect(() => partTimeLeaveHours({ ...mom, fullTimeEntitlementDays: -1 })).toThrow(SgRulesInputError);
    expect(() => partTimeLeaveHours({ ...mom, partTimeHoursPerWeek: 45, fullTimeEntitlementDays: 7 })).toThrow(
      /cannot exceed/,
    );
  });
});
