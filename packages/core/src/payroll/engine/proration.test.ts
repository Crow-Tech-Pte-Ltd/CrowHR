import { describe, expect, it } from "vitest";
import { item, payInput } from "../../testing/payroll-input.ts";
import { prorate } from "./proration.ts";

const lineAmount = (r: ReturnType<typeof prorate>, code: string) => r.lines.find((l) => l.code === code)?.amountCents;

describe("pro-ration (MOM incomplete month)", () => {
  it("pays a full month without pro-ration", () => {
    const r = prorate(payInput());
    expect(r.basicCents).toBe(400_000);
    expect(r.nplCents).toBe(0);
    expect(r.prorated).toBe(false);
    expect(r.issues).toEqual([]);
  });

  it("pro-rates a mid-month joiner: 16 Mar 2026, 12 of 22 working days → S$2,181.82", () => {
    const r = prorate(
      payInput({
        run: { month: "2026-03" },
        employment: { hireDate: "2026-03-16" },
        compensation: [{ from: "2026-03-16", to: null, payBasis: "monthly", amountCents: 400_000 }],
      }),
    );
    expect(r.basicCents).toBe(218_182);
    expect(r.lines[0]?.detail).toBe("12 of 22 working days");
    expect(r.prorated).toBe(true);
    expect(r.fullMonthlyOwCents).toBe(400_000);
  });

  it("pro-rates a leaver to their last day (15 Oct 2026: 11 of 22)", () => {
    const r = prorate(payInput({ employment: { lastWorkingDay: "2026-10-15" } }));
    expect(r.basicCents).toBe(200_000);
  });

  it("shows no-pay leave as a deduction: S$3,000, 2 of 22 days → S$272.73", () => {
    const r = prorate(
      payInput({
        compensation: [{ from: "2020-01-01", to: null, payBasis: "monthly", amountCents: 300_000 }],
        items: [item({ kind: "unpaid_leave", days: 2 })],
      }),
    );
    expect(r.basicCents).toBe(300_000);
    expect(r.nplCents).toBe(27_273);
    expect(lineAmount(r, "NPL")).toBe(27_273);
    expect(r.lines.find((l) => l.code === "NPL")?.label).toBe("No-pay leave (2 days)");
  });

  it("splits a mid-month raise into two segments", () => {
    const r = prorate(
      payInput({
        compensation: [
          { from: "2020-01-01", to: "2026-10-16", payBasis: "monthly", amountCents: 400_000 },
          { from: "2026-10-16", to: null, payBasis: "monthly", amountCents: 440_000 },
        ],
      }),
    );
    expect(r.basicCents).toBe(200_000 + 220_000);
    expect(r.monthlyBasicAtEndCents).toBe(440_000);
  });

  it("pays hourly staff rate × hours and blocks without hours", () => {
    const comp = [{ from: "2020-01-01", to: null, payBasis: "hourly" as const, amountCents: 1_100 }];
    expect(prorate(payInput({ compensation: comp, items: [item({ kind: "hours", minutes: 4_800 })] })).basicCents).toBe(
      88_000,
    );
    const missing = prorate(payInput({ compensation: comp }));
    expect(missing.issues.map((i) => [i.code, i.severity])).toEqual([["HOURS_MISSING", "blocking"]]);
  });

  it("warns when a shift schedule forces the 5-day assumption", () => {
    const r = prorate(payInput({ employment: { pattern: null, hireDate: "2026-10-16" } }));
    expect(r.issues.map((i) => i.code)).toContain("PRORATION_PATTERN_ASSUMED");
    expect(r.basicCents).toBe(200_000);
  });

  it("blocks without compensation and outside employment", () => {
    expect(prorate(payInput({ compensation: [] })).issues[0]?.code).toBe("NO_COMPENSATION");
    expect(prorate(payInput({ employment: { hireDate: "2026-11-02" } })).issues[0]?.code).toBe(
      "NOT_EMPLOYED_IN_PERIOD",
    );
  });

  it("pro-rates allowances unless the type opts out", () => {
    const r = prorate(
      payInput({
        employment: { hireDate: "2026-10-16" },
        allowances: [
          {
            id: "a1",
            code: "TRANSPORT",
            name: "Transport allowance",
            amountCents: 22_000,
            from: "2026-10-16",
            to: null,
            cpfLiable: true,
            prorate: true,
          },
          {
            id: "a2",
            code: "PHONE",
            name: "Phone allowance",
            amountCents: 5_000,
            from: "2026-10-16",
            to: null,
            cpfLiable: false,
            prorate: false,
          },
        ],
      }),
    );
    expect(lineAmount(r, "ALLOWANCE_TRANSPORT")).toBe(11_000);
    expect(lineAmount(r, "ALLOWANCE_PHONE")).toBe(5_000);
    expect(r.allowanceOwCents).toBe(11_000);
    expect(r.allowanceNonCpfCents).toBe(5_000);
  });
});
