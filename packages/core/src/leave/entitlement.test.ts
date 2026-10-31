import { describe, expect, it } from "vitest";
import type { LeavePolicy } from "../db/schema/leave.ts";
import { AppError } from "../errors.ts";
import { assertPolicyAtLeastStatutory, eligibleFromDate, entitlementFor, roundLeaveDays } from "./entitlement.ts";
import { child, employee, leaveType, schedule } from "./fixtures.test-helpers.ts";

const annual = leaveType("annual");
const base = annual.policy;

describe("entitlements", () => {
  it("MOM rounding: below half down, half or more up", () => {
    expect([roundLeaveDays(1.49), roundLeaveDays(1.5), roundLeaveDays(1.75), roundLeaveDays(3.33)]).toEqual([
      1, 2, 2, 3,
    ]);
  });

  it("annual leave: 0 before 3 months, then pro-rated by completed months in the first year", () => {
    const t = employee({ hireDate: "2026-07-14" });
    expect(eligibleFromDate("2026-07-14", 3)).toBe("2026-10-14");
    const before = entitlementFor(t, annual, { year: 2026, asOf: "2026-10-13" });
    expect(before).toMatchObject({ eligible: false, hundredths: 0, eligibleFrom: "2026-10-14" });
    expect(entitlementFor(t, annual, { year: 2026, asOf: "2026-10-14" }).hundredths).toBe(200);
    // 5 completed months by 31 Dec: 5/12 × 7 = 2.92 → 3.
    expect(entitlementFor(t, annual, { year: 2026, asOf: "2026-12-31" }).hundredths).toBe(300);
    expect(entitlementFor(t, annual, { year: 2027, asOf: "2027-01-01" }).hundredths).toBe(800);
    // Month-end hire: 31 Jan + 3 months ends 30 Apr.
    expect(eligibleFromDate("2026-01-31", 3)).toBe("2026-05-01");
  });

  it("service-year scale, monthly accrual and the year of leaving", () => {
    const t = employee({ hireDate: "2024-01-02" });
    expect(entitlementFor(t, annual, { year: 2026, asOf: "2026-03-01" }).hundredths).toBe(900);
    const monthly = { ...annual, policy: { ...base, accrual: "monthly" as const } };
    expect(entitlementFor(t, monthly, { year: 2026, asOf: "2026-07-01" }).hundredths).toBe(450);
    expect(entitlementFor(t, monthly, { year: 2026, asOf: "2026-12-31" }).hundredths).toBe(800);
    const leaver = employee({ hireDate: "2024-01-02", lastWorkingDay: "2026-06-30" });
    const e = entitlementFor(leaver, annual, { year: 2026, asOf: "2026-06-01" });
    // Service year 3 (9 days) × 6/12 = 4.5 → 5.
    expect(e.hundredths).toBe(500);
    expect(e.explanation.join(" ")).toMatch(/Leaving on 30 Jun 2026/);
  });

  it("company policies by service, never below the Employment Act", () => {
    const steps = {
      ...annual,
      policy: {
        ...base,
        entitlement: {
          basis: "by_service" as const,
          steps: [
            { fromServiceYear: 1, days: 10 },
            { fromServiceYear: 3, days: 15 },
          ],
        },
      },
    };
    expect(
      entitlementFor(employee({ hireDate: "2024-01-02" }), steps, { year: 2026, asOf: "2026-03-01" }).hundredths,
    ).toBe(1500);
    expect(
      entitlementFor(employee({ hireDate: "2015-01-02" }), steps, { year: 2026, asOf: "2026-03-01" }).hundredths,
    ).toBe(1500);
    const err = (p: Partial<LeavePolicy>) => {
      try {
        assertPolicyAtLeastStatutory(annual, { ...base, ...p });
        return null;
      } catch (e) {
        return e instanceof AppError ? `${e.code}: ${e.message}` : String(e);
      }
    };
    expect(err({ entitlement: { basis: "fixed", days: 5 } })).toMatch(
      /below_statutory: Service year 1 needs at least 7 days/,
    );
    expect(err({ entitlement: { basis: "fixed", days: 13 } })).toMatch(/Service year 8 needs at least 14/);
    expect(err({ entitlement: { basis: "fixed", days: 14 } })).toBeNull();
    expect(err({ minServiceMonths: 6 })).toMatch(/at most 3 months/);
    expect(err({ entitlement: { basis: "unlimited" } })).toMatch(/set by law/);
    expect(() =>
      assertPolicyAtLeastStatutory(leaveType("hospitalisation"), {
        ...base,
        prorate: false,
        entitlement: { basis: "fixed", days: 30 },
      }),
    ).toThrow(/at least 60 days/);
    expect(() =>
      assertPolicyAtLeastStatutory(leaveType("maternity"), { ...base, entitlement: { basis: "fixed", days: 200 } }),
    ).toThrow(/statutory rules/);
  });

  it("sick leave steps by completed months; company enhancement", () => {
    const t = employee({ hireDate: "2026-07-14" });
    expect(entitlementFor(t, leaveType("sick_outpatient"), { year: 2026, asOf: "2026-11-14" }).hundredths).toBe(800);
    expect(entitlementFor(t, leaveType("hospitalisation"), { year: 2026, asOf: "2026-11-14" }).hundredths).toBe(3000);
    expect(entitlementFor(t, leaveType("hospitalisation"), { year: 2027, asOf: "2027-02-01" }).hundredths).toBe(6000);
    const generous = leaveType("sick_outpatient", {
      policy: { ...leaveType("sick_outpatient").policy, entitlement: { basis: "fixed", days: 18 } },
    });
    expect(entitlementFor(employee({}), generous, { year: 2026, asOf: "2026-03-01" }).hundredths).toBe(1800);
  });

  it("part-timers hold annual leave in hours from the comparable full-timer", () => {
    const pt = employee({
      hireDate: "2025-01-06",
      employmentType: "part_time",
      days: [
        ...Array.from({ length: 5 }, () => ({ type: "working" as const, minutes: 240 })),
        { type: "off", minutes: 0 },
        { type: "rest", minutes: 0 },
      ],
      // The org's default 44-hour, 5.5-day week at 8 h a day (MOM's example full-timer).
      extraSchedules: [
        schedule(
          "office",
          [
            ...Array.from({ length: 5 }, () => ({ type: "working" as const, minutes: 480 })),
            { type: "half", minutes: 240 },
            { type: "rest", minutes: 0 },
          ],
          { isDefault: true, weeklyMinutes: 44 * 60 },
        ),
      ],
    });
    // Service year 2 → 8 days: 20/44 × 8 × 8 = 29.09 → 29.1 h.
    const e = entitlementFor(pt, annual, { year: 2026, asOf: "2026-03-01" });
    expect(e).toMatchObject({ unit: "hours", hundredths: 2910 });
    // MOM's example: 7 days → 25.5 h.
    const y1 = entitlementFor(pt, annual, { year: 2025, asOf: "2025-12-31" });
    expect(y1.unit).toBe("hours");
    // Childcare stays in days.
    expect(
      entitlementFor(pt, leaveType("childcare"), {
        year: 2026,
        asOf: "2026-03-01",
        children: [child({ birthDate: "2023-01-10" })],
      }).unit,
    ).toBe("days");
  });

  it("paternity: 4 weeks from 1 Apr 2025, 2 weeks for a stillbirth, per child", () => {
    const dad = employee({ hireDate: "2023-01-02", gender: "male" });
    const pat = leaveType("paternity");
    expect(
      entitlementFor(dad, pat, { year: 2026, asOf: "2026-06-01", child: child({ birthDate: "2026-06-01" }) }),
    ).toMatchObject({
      eligible: true,
      perChild: true,
      hundredths: 2000,
    });
    expect(
      entitlementFor(dad, pat, {
        year: 2026,
        asOf: "2026-06-01",
        child: child({ birthDate: "2026-06-01", stillborn: true }),
      }).hundredths,
    ).toBe(1000);
    const unmarried = entitlementFor(dad, pat, {
      year: 2026,
      asOf: "2026-06-01",
      child: child({ birthDate: "2026-06-01", marriedToMother: false }),
    });
    expect(unmarried.eligible).toBe(false);
    expect(entitlementFor(dad, pat, { year: 2026, asOf: "2026-06-01" }).explanation[0]).toMatch(/Choose the child/);
  });

  it("shared parental leave: 10 weeks from 1 Apr 2026 (EDD rule), 6 before, none for a stillbirth", () => {
    const mum = employee({ hireDate: "2023-01-02", gender: "female" });
    const spl = leaveType("shared_parental");
    const at = (c: Parameters<typeof child>[0]) =>
      entitlementFor(mum, spl, { year: 2026, asOf: "2026-04-01", child: child(c) });
    expect(at({ birthDate: "2026-04-01" }).hundredths).toBe(5000);
    expect(at({ birthDate: "2026-03-31" }).hundredths).toBe(3000);
    expect(at({ birthDate: "2026-03-25", expectedDeliveryDate: "2026-04-05" }).hundredths).toBe(5000);
    expect(at({ birthDate: "2026-04-01", stillborn: true }).eligible).toBe(false);
  });

  it("GPML: 1st child employer weeks 1–8, Government 9–16; 3rd child all Government; non-SC child EA 12 weeks", () => {
    const mum = employee({ hireDate: "2023-01-02", gender: "female" });
    const mat = leaveType("maternity");
    const first = entitlementFor(mum, mat, {
      year: 2026,
      asOf: "2026-09-01",
      child: child({ birthDate: "2026-09-01" }),
    });
    expect(first.hundredths).toBe(8000);
    expect(first.funding).toEqual([
      { fromDay: 1, toDay: 40, payer: "employer" },
      { fromDay: 41, toDay: 80, payer: "government" },
    ]);
    const third = entitlementFor(mum, mat, {
      year: 2026,
      asOf: "2026-09-01",
      child: child({ birthDate: "2026-09-01", birthOrder: 3 }),
    });
    expect(third.funding).toEqual([{ fromDay: 1, toDay: 80, payer: "government" }]);
    const ea = entitlementFor(mum, mat, {
      year: 2026,
      asOf: "2026-09-01",
      child: child({ birthDate: "2026-09-01", isCitizen: false }),
    });
    expect(ea.hundredths).toBe(6000);
  });

  it("childcare per year from the children; infant care needs a child under 2", () => {
    const parent = employee({ hireDate: "2023-01-02" });
    const kids = [child({ birthDate: "2022-05-01" })];
    expect(
      entitlementFor(parent, leaveType("childcare"), { year: 2026, asOf: "2026-03-01", children: kids }).hundredths,
    ).toBe(600);
    expect(
      entitlementFor(parent, leaveType("extended_childcare"), { year: 2026, asOf: "2026-03-01", children: kids })
        .eligible,
    ).toBe(false);
    const older = [child({ birthDate: "2017-05-01" })];
    expect(
      entitlementFor(parent, leaveType("extended_childcare"), { year: 2026, asOf: "2026-03-01", children: older })
        .hundredths,
    ).toBe(200);
    expect(
      entitlementFor(parent, leaveType("childcare"), { year: 2026, asOf: "2026-03-01", children: [] }).eligible,
    ).toBe(false);
    const baby = [child({ birthDate: "2025-08-01" })];
    expect(
      entitlementFor(parent, leaveType("infant_care"), { year: 2026, asOf: "2026-03-01", children: baby }).hundredths,
    ).toBe(1200);
    // New hire: GPCL pro-rated (4 completed months → 2 days).
    const newbie = employee({ hireDate: "2026-07-14" });
    expect(
      entitlementFor(newbie, leaveType("childcare"), { year: 2026, asOf: "2026-11-15", children: kids }).hundredths,
    ).toBe(200);
  });

  it("NS and no-pay leave have no fixed allowance", () => {
    expect(entitlementFor(employee({}), leaveType("no_pay"), { year: 2026, asOf: "2026-03-01" })).toMatchObject({
      tracked: false,
    });
    expect(entitlementFor(employee({}), leaveType("ns"), { year: 2026, asOf: "2026-03-01" }).tracked).toBe(false);
  });
});
