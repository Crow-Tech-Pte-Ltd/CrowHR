import { describe, expect, it } from "vitest";
import { checkDeductions } from "./deductions.ts";

const codes = (r: ReturnType<typeof checkDeductions>) => r.issues.map((i) => `${i.code}:${i.severity}`);

describe("Employment Act deduction limits", () => {
  it("caps damage or loss at 25% of salary", () => {
    const r = checkDeductions({
      salaryCents: 300_000,
      deductions: [{ category: "damage_loss", label: "Broken espresso machine", amountCents: 80_000 }],
      statutoryEmployeeCents: 0,
      finalPay: false,
    });
    expect(codes(r)).toEqual(["EA_DEDUCTION_CATEGORY_CAP:blocking"]);
    expect(r.issues[0]?.message).toContain("by S$50.00");
  });

  it("allows a loan instalment at exactly 25% and leaves it out of the 50% limit", () => {
    const r = checkDeductions({
      salaryCents: 200_000,
      deductions: [{ category: "loan", label: "Loan", amountCents: 50_000 }],
      statutoryEmployeeCents: 40_000,
      finalPay: false,
    });
    expect(r.issues).toEqual([]);
  });

  it("counts employee CPF toward the 50% overall limit", () => {
    const input = {
      salaryCents: 200_000,
      deductions: [{ category: "consented" as const, label: "Gym", amountCents: 70_000 }],
      statutoryEmployeeCents: 40_000,
    };
    expect(codes(checkDeductions({ ...input, finalPay: false }))).toEqual(["EA_DEDUCTION_OVERALL_CAP:blocking"]);
    // MOM: the cap may be exceeded on the final salary payment.
    expect(codes(checkDeductions({ ...input, finalPay: true }))).toEqual([
      "EA_DEDUCTION_OVERALL_CAP_FINAL_PAY:warning",
    ]);
  });

  it("excludes absence, overpayment and co-operative deductions from the 50% limit", () => {
    const r = checkDeductions({
      salaryCents: 100_000,
      deductions: [
        { category: "absence", label: "Absent 2 days", amountCents: 30_000 },
        { category: "overpayment", label: "Overpaid in Sep", amountCents: 30_000 },
        { category: "cooperative", label: "Co-op", amountCents: 10_000 },
      ],
      statutoryEmployeeCents: 20_000,
      finalPay: false,
    });
    expect(r.issues).toEqual([]);
  });
});
