import { describe, expect, it } from "vitest";
import { item, payInput } from "../../testing/payroll-input.ts";
import { canonicalHash, canonicalJson } from "./canonical.ts";
import { computeEmployeePay } from "./compute.ts";

const blocking = (r: ReturnType<typeof computeEmployeePay>) =>
  r.issues.filter((i) => i.severity === "blocking").map((i) => i.code);

describe("computeEmployeePay", () => {
  it("full month SC S$4,000: CPF 37% / 20%, CDAC S$1.50, SDL S$10, net S$3,198.50", () => {
    const r = computeEmployeePay(payInput());
    expect(r.totals.grossCents).toBe(400_000);
    expect([r.totals.cpfEmployeeCents, r.totals.cpfEmployerCents]).toEqual([80_000, 68_000]);
    expect(r.month.cpfTotalCents).toBe(148_000);
    expect(r.totals.shgCents).toBe(150);
    expect(r.shgFunds).toEqual(["CDAC"]);
    expect(r.totals.sdlUnits1e4Cent).toBe(10_000_000);
    expect(r.totals.netCents).toBe(319_850);
    expect(r.cpf?.rateTableId).toBe("CPF_2026_SC_AND_SPR3");
    expect(r.rules.map((x) => x.family)).toEqual(
      expect.arrayContaining(["CPF rate table 1", "CPF OW ceiling", "SDL", "CDAC table"]),
    );
    expect(r.rules.every((x) => x.source.startsWith("https://"))).toBe(true);
    expect(r.stateAfter.owSubjectCents).toBe(400_000);
    expect(blocking(r)).toEqual([]);
  });

  it("is deterministic: same snapshot, byte-identical result", async () => {
    const input = payInput({
      items: [item({ kind: "bonus", amountCents: 500_000, wageClass: "AW", awPayableDate: "2026-10-20" })],
    });
    const a = computeEmployeePay(input);
    const b = computeEmployeePay(structuredClone(input));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(await canonicalHash(a)).toBe(await canonicalHash(b));
  });

  it("classifies AW with a payable date and blocks AW payable outside the period", () => {
    const ok = computeEmployeePay(
      payInput({
        items: [
          item({
            kind: "bonus",
            label: "Year-end bonus",
            amountCents: 500_000,
            wageClass: "AW",
            awPayableDate: "2026-10-20",
          }),
        ],
      }),
    );
    expect(ok.totals.awCpfCents).toBe(500_000);
    expect(ok.cpf?.awSubjectCents).toBe(500_000);
    expect(ok.stateAfter.awPayments).toEqual([
      { payableMonth: "2026-10", owCents: 400_000, awPayableCents: 500_000, awSubjectCents: 500_000 },
    ]);
    const bad = computeEmployeePay(
      payInput({
        items: [item({ kind: "bonus", amountCents: 500_000, wageClass: "AW", awPayableDate: "2026-09-30" })],
      }),
    );
    expect(blocking(bad)).toEqual(["AW_PAYABLE_OUTSIDE_PERIOD"]);
  });

  it("computes statutory OT (MOM example: S$2,600 non-workman, 2 h → S$40.80) and needs an amount outside Part 4", () => {
    const r = computeEmployeePay(
      payInput({
        compensation: [{ from: "2020-01-01", to: null, payBasis: "monthly", amountCents: 260_000 }],
        items: [item({ kind: "overtime", label: "Overtime", minutes: 120 })],
      }),
    );
    expect(r.totals.overtimeCents).toBe(4_080);
    expect(r.totals.owCpfCents).toBe(264_080);
    expect(r.overtime?.minutes).toBe(120);
    const notCovered = computeEmployeePay(payInput({ items: [item({ kind: "overtime", minutes: 120 })] }));
    expect(blocking(notCovered)).toEqual(["OT_NOT_STATUTORY"]);
    const contractual = computeEmployeePay(
      payInput({ items: [item({ kind: "overtime", minutes: 120, amountCents: 6_000 })] }),
    );
    expect(contractual.totals.overtimeCents).toBe(6_000);
  });

  it("pays reimbursements outside wages", () => {
    const r = computeEmployeePay(
      payInput({ reimbursements: [{ claimId: "c1", typeName: "Transport", amountCents: 5_000 }] }),
    );
    expect(r.totals.totalWagesCents).toBe(400_000);
    expect(r.totals.netCents).toBe(319_850 + 5_000);
    expect(r.lines.find((l) => l.category === "claim")?.label).toBe("Claims reimbursement: Transport");
  });

  it("charges only the month's difference in a second run of the month (bonus run)", () => {
    const r = computeEmployeePay(
      payInput({
        run: { kind: "off_cycle", offCycleReason: "bonus" },
        items: [item({ kind: "bonus", amountCents: 100_000, wageClass: "AW", awPayableDate: "2026-10-25" })],
        monthBefore: {
          owCpfCents: 400_000,
          awCpfCents: 0,
          totalWagesCents: 400_000,
          chargedByOthers: {
            cpfTotalCents: 148_000,
            cpfEmployeeCents: 80_000,
            cpfEmployerCents: 68_000,
            shgCents: { CDAC: 150 },
            sdlUnits1e4Cent: 10_000_000,
          },
          chargedByReplaced: {
            cpfTotalCents: 0,
            cpfEmployeeCents: 0,
            cpfEmployerCents: 0,
            shgCents: {},
            sdlUnits1e4Cent: 0,
          },
          netPaidByReplacedCents: 0,
          runIds: ["run-0"],
        },
      }),
    );
    expect(r.totals.basicCents).toBe(0);
    expect(r.month.cpfTotalCents).toBe(185_000); // 37% × $5,000
    expect(r.charged.cpfTotalCents).toBe(37_000);
    expect(r.charged.cpfEmployeeCents).toBe(20_000);
    expect(r.totals.cpfEmployeeCents).toBe(20_000);
    expect(r.charged.shgCents).toEqual({}); // CDAC $1.50 for $3,500–$5,000 is already deducted
    expect(r.charged.sdlUnits1e4Cent).toBe(1_250_000); // $11.25 max − $10 already
    expect(r.totals.netCents).toBe(100_000 - 20_000);
  });

  it("turns an sg-rules refusal into a blocking issue and still shows the pay", () => {
    const r = computeEmployeePay(
      payInput({
        compensation: [{ from: "2020-01-01", to: null, payBasis: "monthly", amountCents: 30_000 }],
        items: [item({ kind: "bonus", amountCents: 30_000, wageClass: "AW", awPayableDate: "2026-10-31" })],
        cpfStateBefore: {
          owSubjectCents: 7_200_000,
          awPayments: [
            { payableMonth: "2026-03", owCents: 800_000, awPayableCents: 9_000_000, awSubjectCents: 9_000_000 },
          ],
        },
      }),
    );
    expect(blocking(r)).toContain("CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED");
    const issue = r.issues.find((i) => i.code === "CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED");
    expect(issue?.message).toContain("Confirm the amount with CPF Board");
    expect(issue?.source).toMatch(/^https:\/\/www\.cpf\.gov\.sg/);
    expect(r.totals.grossCents).toBe(60_000);
    expect(r.cpf).toBeNull();
    expect(r.lines.some((l) => l.category === "cpf_employee")).toBe(false);
  });

  it("blocks a negative net and enforces the 50% deduction limit", () => {
    const r = computeEmployeePay(
      payInput({
        items: [item({ kind: "deduction", label: "Consented", amountCents: 150_000, deductionCategory: "consented" })],
      }),
    );
    expect(blocking(r)).toEqual(["EA_DEDUCTION_OVERALL_CAP"]);
    const neg = computeEmployeePay(
      payInput({
        items: [item({ kind: "deduction", label: "Overpaid", amountCents: 390_000, deductionCategory: "overpayment" })],
      }),
    );
    expect(blocking(neg)).toEqual(["NET_NEGATIVE"]);
  });

  it("applies no CPF to a foreigner but still SDL; EP holder of Indian descent gives to SINDA", () => {
    const r = computeEmployeePay(
      payInput({
        employee: {
          residency: { status: "FOREIGNER" },
          race: ["indian"],
          workPass: { type: "EP", issuedOn: "2024-05-01", expiresOn: "2027-05-01", cancelledOn: null },
        },
        compensation: [{ from: "2020-01-01", to: null, payBasis: "monthly", amountCents: 900_000 }],
      }),
    );
    expect(r.totals.cpfEmployeeCents).toBe(0);
    expect(r.cpf?.residencyCategory).toBe("FOREIGNER");
    expect(r.shgFunds).toEqual(["SINDA"]);
    expect(r.totals.sdlUnits1e4Cent).toBe(11_250_000);
  });

  it("uses SPR 1st-year graduated rates", () => {
    const r = computeEmployeePay(
      payInput({ employee: { residency: { status: "SPR", sprDate: "2026-03-01", option: "GG" } } }),
    );
    expect(r.cpf?.residencyCategory).toBe("SPR1_GG");
    expect(r.month.cpfTotalCents).toBe(36_000);
    expect(r.totals.cpfEmployeeCents).toBe(20_000);
  });

  it("warns when OT is paid more than 14 days after the period", () => {
    const r = computeEmployeePay(
      payInput({
        run: { payDate: "2026-11-20" },
        items: [item({ kind: "overtime", minutes: 60, amountCents: 3_000 })],
      }),
    );
    expect(r.issues.map((i) => i.code)).toContain("EA_OT_PAID_LATE");
  });

  it("an adjustment shows revised figures and the net still payable", () => {
    const r = computeEmployeePay(
      payInput({
        run: { kind: "adjustment" },
        allowances: [
          {
            id: "a1",
            code: "MEAL",
            name: "Meal allowance",
            amountCents: 20_000,
            from: "2020-01-01",
            to: null,
            cpfLiable: true,
            prorate: true,
          },
        ],
        monthBefore: {
          owCpfCents: 0,
          awCpfCents: 0,
          totalWagesCents: 0,
          chargedByOthers: {
            cpfTotalCents: 0,
            cpfEmployeeCents: 0,
            cpfEmployerCents: 0,
            shgCents: {},
            sdlUnits1e4Cent: 0,
          },
          chargedByReplaced: {
            cpfTotalCents: 148_000,
            cpfEmployeeCents: 80_000,
            cpfEmployerCents: 68_000,
            shgCents: { CDAC: 150 },
            sdlUnits1e4Cent: 10_000_000,
          },
          netPaidByReplacedCents: 319_850,
          runIds: ["run-0"],
        },
      }),
    );
    expect(r.totals.grossCents).toBe(420_000);
    expect(r.totals.cpfEmployeeCents).toBe(84_000);
    expect(r.charged.cpfTotalCents).toBe(155_400 - 148_000);
    expect(r.charged.cpfEmployeeCents).toBe(4_000);
    expect(r.totals.netCents).toBe(420_000 - 84_000 - 150);
    expect(r.totals.netPayableCents).toBe(420_000 - 84_000 - 150 - 319_850);
  });
});
