import { describe, expect, it } from "vitest";
import { MOM_WORKING_DAYS_2026 } from "../__fixtures__/mom-working-days-2026.ts";
import { checkOvertimeLimits, computeOvertimePay } from "./overtime.ts";
import { dailyRate, hourlyBasicRate, isPart4Covered } from "./rates.ts";
import {
  incompleteMonthSalary,
  publicHolidayTimeOffInLieuAllowed,
  publicHolidayWorkPay,
  restDayWorkPay,
  WORK_PATTERNS,
  workingDaysInMonth,
} from "./salary.ts";

const DATE = "2026-10-31";
const nonWorkman = { date: DATE, isWorkman: false, isManagerOrExecutive: false };
const workman = { date: DATE, isWorkman: true, isManagerOrExecutive: false };

describe("Part 4 coverage", () => {
  it.each([
    [{ ...nonWorkman, monthlyBasicCents: 260_000 }, true],
    [{ ...nonWorkman, monthlyBasicCents: 260_001 }, false],
    [{ ...workman, monthlyBasicCents: 450_000 }, true],
    [{ ...workman, monthlyBasicCents: 450_001 }, false],
    [{ ...nonWorkman, isManagerOrExecutive: true, monthlyBasicCents: 200_000 }, false],
  ])("%j → covered %s", (input, covered) => {
    expect(isPart4Covered(input).covered).toBe(covered);
  });

  it("warns on a manager/executive earning $2,600 or less", () => {
    const r = isPart4Covered({ ...nonWorkman, isManagerOrExecutive: true, monthlyBasicCents: 250_000 });
    expect(r.issues.map((i) => i.code)).toEqual(["EA_ME_LOW_SALARY"]);
    expect(isPart4Covered({ ...nonWorkman, isManagerOrExecutive: true, monthlyBasicCents: 500_000 }).issues).toEqual(
      [],
    );
  });
});

describe("rates", () => {
  it("hourly basic rate = 12 × monthly / (52 × 44); part-timers use their weekly hours", () => {
    expect(hourlyBasicRate({ date: DATE, monthlyBasicCents: 260_000 }).text).toBe(
      "Hourly basic rate = (12 × $2,600.00) / (52 × 44) = $≈13.636363",
    );
    expect(hourlyBasicRate({ date: DATE, monthlyBasicCents: 260_000 }).displayCents).toBe(1_364);
    expect(hourlyBasicRate({ date: DATE, monthlyBasicCents: 104_000, weeklyHours: 20 }).displayCents).toBe(1_200);
    expect(() => hourlyBasicRate({ date: DATE, monthlyBasicCents: 1, weeklyHours: 0 })).toThrow(/weeklyHours/);
  });

  it("daily rate = 12 × monthly / (52 × days per week), half days allowed", () => {
    expect(dailyRate({ monthlyCents: 260_000, workingDaysPerWeek: 5, kind: "basic" }).displayCents).toBe(12_000);
    expect(dailyRate({ monthlyCents: 286_000, workingDaysPerWeek: 5.5, kind: "gross" }).displayCents).toBe(12_000);
    expect(() => dailyRate({ monthlyCents: 1, workingDaysPerWeek: 5.25, kind: "basic" })).toThrow(/multiple of 0.5/);
    expect(() => dailyRate({ monthlyCents: 1, workingDaysPerWeek: 0, kind: "basic" })).toThrow(/more than 0/);
  });
});

describe("overtime", () => {
  it("reproduces MOM's published example: non-workman on $2,600, 2 h → $13.60 × 1.5 × 2 = $40.80", () => {
    const r = computeOvertimePay({ ...nonWorkman, monthlyBasicCents: 260_000, overtimeMinutes: 120 });
    expect(r.eligible).toBe(true);
    expect(r.payCents).toBe(4_080);
    expect(r.hourlyRateText).toMatch(/published non-workman hourly cap \$13\.60/);
  });

  it("EXACT_FORMULA option pays the unrounded $13.6364/h ($40.91) — an employer enhancement", () => {
    const r = computeOvertimePay({
      ...nonWorkman,
      monthlyBasicCents: 260_000,
      overtimeMinutes: 120,
      method: "EXACT_FORMULA",
    });
    expect(r.payCents).toBe(4_091);
    expect(r.method).toBe("EXACT_FORMULA");
  });

  it("is monotone just under the cap ($2,599 is limited to $13.60/h too)", () => {
    expect(computeOvertimePay({ ...nonWorkman, monthlyBasicCents: 259_900, overtimeMinutes: 120 }).payCents).toBe(
      4_080,
    );
    expect(computeOvertimePay({ ...nonWorkman, monthlyBasicCents: 200_000, overtimeMinutes: 120 }).payCents).toBe(
      3_147,
    );
  });

  it("caps non-workmen at the $2,600 base but not workmen", () => {
    expect(computeOvertimePay({ ...workman, monthlyBasicCents: 300_000, overtimeMinutes: 120 }).payCents).toBe(4_720);
    const r = computeOvertimePay({ ...workman, monthlyBasicCents: 300_000, overtimeMinutes: 90 });
    expect(r.payCents).toBe(3_540); // 15.7343 × 1.5 × 1.5 = 35.4021
    expect(r.hourlyRateText).toMatch(/workman: no cap/);
  });

  it("returns no statutory OT outside Part 4", () => {
    const r = computeOvertimePay({ ...nonWorkman, monthlyBasicCents: 300_000, overtimeMinutes: 600 });
    expect(r).toMatchObject({ eligible: false, payCents: 0, hourlyRateText: null });
    expect(r.working.map((w) => w.code)).toContain("EA_OT_NOT_STATUTORY");
  });

  it("warns (does not throw) above 72 OT hours a month or 12 hours a day", () => {
    const r = computeOvertimePay({ ...nonWorkman, monthlyBasicCents: 200_000, overtimeMinutes: 73 * 60 });
    expect(r.payCents).toBeGreaterThan(0);
    expect(r.issues.map((i) => i.code)).toEqual(["EA_OT_MONTHLY_LIMIT"]);
    expect(checkOvertimeLimits({ date: DATE, monthOvertimeMinutes: 72 * 60 })).toEqual([]);
    expect(
      checkOvertimeLimits({
        date: DATE,
        monthOvertimeMinutes: 0,
        dailyMinutesWorked: [
          { date: "2026-10-01", minutes: 12 * 60 },
          { date: "2026-10-02", minutes: 12 * 60 + 1 },
        ],
      }).map((i) => i.message),
    ).toEqual([expect.stringMatching(/^2026-10-02/)]);
    expect(() => computeOvertimePay({ ...nonWorkman, monthlyBasicCents: 1, overtimeMinutes: 1.5 })).toThrow(
      /whole number/,
    );
  });
});

describe("incomplete month", () => {
  it("working-day calendar reproduces MOM's 2026 table (all 36 cells)", () => {
    const patterns = [
      [WORK_PATTERNS.FIVE_DAY, MOM_WORKING_DAYS_2026.fiveDay],
      [WORK_PATTERNS.FIVE_AND_HALF_DAY, MOM_WORKING_DAYS_2026.fiveAndHalfDay],
      [WORK_PATTERNS.SIX_DAY, MOM_WORKING_DAYS_2026.sixDay],
    ] as const;
    for (const [pattern, expected] of patterns) {
      const got = expected.map((_, i) => workingDaysInMonth(`2026-${String(i + 1).padStart(2, "0")}`, pattern));
      expect(got).toEqual([...expected]);
    }
  });

  it("salary = gross / working days × days worked, rounded half up to the cent", () => {
    const r = incompleteMonthSalary({ monthlyGrossCents: 300_000, workingDaysInMonth: 22, daysWorked: 10 });
    expect(r.payCents).toBe(136_364); // 1,363.6363… (PM-01)
    expect(r.working[0]?.text).toContain("$3,000.00 / 22 working days × 10 days worked");
    expect(
      incompleteMonthSalary({ monthlyGrossCents: 300_000, workingDaysInMonth: 24.5, daysWorked: 24.5 }).payCents,
    ).toBe(300_000);
    expect(() => incompleteMonthSalary({ monthlyGrossCents: 1, workingDaysInMonth: 22, daysWorked: 23 })).toThrow(
      /cannot exceed/,
    );
    expect(() => incompleteMonthSalary({ monthlyGrossCents: 1, workingDaysInMonth: 0, daysWorked: 0 })).toThrow(
      /more than 0/,
    );
  });
});

describe("rest-day work", () => {
  const input = { ...nonWorkman, monthlyBasicCents: 200_000, workingDaysPerWeek: 5, normalDailyMinutes: 480 };
  it.each([
    ["EMPLOYER", 180, 1, 9_231, 0],
    ["EMPLOYER", 240, 1, 9_231, 0],
    ["EMPLOYER", 241, 2, 18_462, 0],
    ["EMPLOYER", 600, 2, 21_608, 120],
    ["EMPLOYEE", 180, 0.5, 4_615, 0],
    ["EMPLOYEE", 360, 1, 9_231, 0],
    ["EMPLOYEE", 0, 0, 0, 0],
  ] as const)(
    "at the %s's request, %i minutes → %s day(s), %i cents",
    (requestedBy, minutesWorked, multiple, pay, ot) => {
      const r = restDayWorkPay({ ...input, requestedBy, minutesWorked });
      expect(r.dayMultiple).toBe(multiple);
      expect(r.payCents).toBe(pay);
      expect(r.overtimeMinutes).toBe(ot);
    },
  );

  it("applies to Part 4 employees only and validates minutes", () => {
    expect(
      restDayWorkPay({ ...input, monthlyBasicCents: 300_000, requestedBy: "EMPLOYER", minutesWorked: 300 }).eligible,
    ).toBe(false);
    expect(() => restDayWorkPay({ ...input, requestedBy: "EMPLOYER", minutesWorked: -1 })).toThrow(/minutes/);
    expect(() =>
      restDayWorkPay({ ...input, normalDailyMinutes: 0, requestedBy: "EMPLOYER", minutesWorked: 1 }),
    ).toThrow(/more than 0/);
  });
});

describe("public-holiday work", () => {
  it("working day → 1 extra day at basic; non-working day → 1 extra day at gross", () => {
    const common = { monthlyBasicCents: 200_000, monthlyGrossCents: 250_000, workingDaysPerWeek: 5 };
    expect(publicHolidayWorkPay({ ...common, dayType: "WORKING_DAY" }).extraPayCents).toBe(9_231);
    expect(publicHolidayWorkPay({ ...common, dayType: "NON_WORKING_DAY" }).extraPayCents).toBe(11_538);
  });

  it("time off in lieu only outside Part 4", () => {
    expect(publicHolidayTimeOffInLieuAllowed({ ...nonWorkman, monthlyBasicCents: 260_000 }).allowed).toBe(false);
    expect(publicHolidayTimeOffInLieuAllowed({ ...nonWorkman, monthlyBasicCents: 260_001 }).allowed).toBe(true);
    expect(
      publicHolidayTimeOffInLieuAllowed({ ...workman, isManagerOrExecutive: true, monthlyBasicCents: 100_000 }).allowed,
    ).toBe(true);
  });
});
