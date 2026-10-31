import { describe, expect, it } from "vitest";
import { CSN_PAYMENT_TYPES, REST_DAYS_PER_WEEK, WORK_PASS_TYPES } from "../tables/registrations.ts";
import { DEDUCTION_CATEGORIES } from "../tables/salary-payment.ts";
import {
  awTopUpRecoveryDeadline,
  checkDeductions,
  overtimeDueBy,
  paymentDeadlines,
  salaryDueBy,
} from "./salary-payment.ts";

const codes = (r: ReturnType<typeof checkDeductions>) => r.issues.map((i) => `${i.code}:${i.severity}`);
const base = { date: "2026-10-31", finalPay: false } as const;

describe("Employment Act payment deadlines (s 21)", () => {
  it("salary within 7 calendar days after the period", () => {
    expect(salaryDueBy("2026-10-31")).toBe("2026-11-07");
    expect(paymentDeadlines("2026-10-31").source).toBe("https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr21-");
  });

  it("overtime within 14 days after the salary period in which it was performed", () => {
    expect(overtimeDueBy("2026-10-20")).toBe("2026-11-14");
    expect(overtimeDueBy("2026-09-28")).toBe("2026-10-14");
  });

  it("AW top-up recovery (CPF Act s 7(9)): six months after the end of the year it was payable", () => {
    expect(awTopUpRecoveryDeadline(2026)).toBe("2027-06-30");
  });
});

describe("Employment Act deduction limits (s 29, s 30, s 32)", () => {
  it("caps damage or loss at 25% of salary", () => {
    const r = checkDeductions({
      ...base,
      salaryCents: 300_000,
      deductions: [{ category: "damage_loss", label: "Machine", amountCents: 80_000 }],
      statutoryEmployeeCents: 0,
    });
    expect(codes(r)).toEqual(["EA_DEDUCTION_CATEGORY_CAP:blocking"]);
    expect(r.issues[0]?.message).toContain("by $50.00");
  });

  it("caps accommodation and amenities TOGETHER at 25% (s 30(2); payroll-choices.md example)", () => {
    const r = checkDeductions({
      ...base,
      salaryCents: 100_000,
      deductions: [
        { category: "accommodation", label: "Dormitory", amountCents: 15_000 },
        { category: "amenities", label: "Meals", amountCents: 15_000 },
      ],
      statutoryEmployeeCents: 20_000,
    });
    expect(codes(r)).toEqual(["EA_DEDUCTION_CATEGORY_CAP:blocking"]);
    expect(r.issues[0]?.message).toContain("Accommodation, amenities and services together");
    expect(r.issues[0]?.source).toBe("https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr30-");
  });

  it("counts employee CPF toward the 50% limit (s 32 excludes only s 27(1)(a), (f), (j)); waived on final pay", () => {
    const input = {
      ...base,
      salaryCents: 200_000,
      deductions: [{ category: "consented" as const, label: "Gym", amountCents: 70_000 }],
      statutoryEmployeeCents: 40_000,
    };
    expect(codes(checkDeductions(input))).toEqual(["EA_DEDUCTION_OVERALL_CAP:blocking"]);
    expect(codes(checkDeductions({ ...input, finalPay: true }))).toEqual([
      "EA_DEDUCTION_OVERALL_CAP_FINAL_PAY:warning",
    ]);
  });

  it("leaves absence, advances, loans, unearned benefits, overpayments and co-operative payments out of the 50% limit", () => {
    const r = checkDeductions({
      ...base,
      salaryCents: 100_000,
      deductions: [
        { category: "absence", label: "Absent", amountCents: 20_000 },
        { category: "overpayment", label: "Overpaid", amountCents: 20_000 },
        { category: "unearned_benefit", label: "Course fee bond", amountCents: 10_000 },
        { category: "cooperative", label: "Co-op", amountCents: 10_000 },
        { category: "loan", label: "Loan", amountCents: 20_000 },
      ],
      statutoryEmployeeCents: 20_000,
    });
    expect(r.issues).toEqual([]);
    expect(DEDUCTION_CATEGORIES.unearned_benefit.exemptFromOverallCap).toBe(true);
  });
});

describe("statutory lookups", () => {
  it("CSN payment types, rest days and pass types", () => {
    expect(CSN_PAYMENT_TYPES).toEqual(["PTE", "AMS", "VCT", "MSE"]);
    expect(REST_DAYS_PER_WEEK).toBe(1);
    expect(WORK_PASS_TYPES.map((p) => p.code)).toContain("S_PASS");
  });
});
