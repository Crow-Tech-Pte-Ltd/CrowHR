import { describe, expect, it } from "vitest";
import { MOM_EMPLOYMENT_RECORDS, MOM_KETS } from "../tables/employment-records.ts";
import { employmentRecordRetention, ketRequirements, requiredKetItems } from "./records.ts";

describe("KET mandatory items (MOM Key employment terms; research §7)", () => {
  it("lists MOM's 18 items in order, with the source", () => {
    const k = ketRequirements({ asAt: "2026-10-31", startDate: "2026-01-01" });
    expect(k.items.map((i) => i.id)).toEqual([
      "employer_name",
      "employee_name",
      "job_title",
      "start_date",
      "duration",
      "working_arrangements",
      "salary_period",
      "basic_salary",
      "fixed_allowances",
      "fixed_deductions",
      "overtime_period",
      "overtime_rate",
      "other_salary",
      "leave",
      "medical_benefits",
      "probation",
      "notice",
      "place_of_work",
    ]);
    expect(k.source).toBe(MOM_KETS);
    // "an employee starting on 1 Jan must receive KETs by 15 Jan"
    expect(k.issueBy).toBe("2026-01-15");
    expect(k.minimumEmploymentDays).toBe(14);
    expect(ketRequirements({ asAt: "2026-10-31" }).issueBy).toBeNull();
  });

  it("drops conditional items that don't apply", () => {
    const base = requiredKetItems({ asAt: "2026-10-31", fixedTerm: false, overtimeEntitled: false }).map((i) => i.id);
    expect(base).not.toContain("duration");
    expect(base).not.toContain("overtime_rate");
    expect(base).not.toContain("place_of_work");
    expect(base).toHaveLength(14);
    const all = requiredKetItems({ asAt: "2026-10-31", fixedTerm: true, overtimeEntitled: true }).map((i) => i.id);
    expect(all).toContain("duration");
    expect(all).toContain("overtime_period");
    expect(all).toHaveLength(17);
  });

  it("refuses dates before KETs became mandatory, and bad dates", () => {
    expect(() => ketRequirements({ asAt: "2015-12-31" })).toThrow(/key employment terms/);
    expect(() => ketRequirements({ asAt: "31-10-2026" })).toThrow();
    expect(() => ketRequirements({ asAt: "2026-10-31", startDate: "2026-13-01" })).toThrow();
  });
});

describe("employment record retention (MOM Employment records)", () => {
  it("reviews ex-employees' records 12 months after they leave, never current employees'", () => {
    expect(employmentRecordRetention({ asAt: "2026-10-31", lastWorkingDay: "2025-10-31" })).toMatchObject({
      reviewFrom: "2026-10-31",
      afterLeavingMonths: 12,
      currentEmployeeMonths: 24,
      source: MOM_EMPLOYMENT_RECORDS,
    });
    // Month-end clamp: 29 Feb + 12 months → 28 Feb.
    expect(employmentRecordRetention({ asAt: "2026-10-31", lastWorkingDay: "2024-02-29" }).reviewFrom).toBe(
      "2025-02-28",
    );
    expect(employmentRecordRetention({ asAt: "2026-10-31", lastWorkingDay: null }).reviewFrom).toBeNull();
    expect(() => employmentRecordRetention({ asAt: "2026-10-31", lastWorkingDay: "2025-02-30x" })).toThrow();
  });
});
