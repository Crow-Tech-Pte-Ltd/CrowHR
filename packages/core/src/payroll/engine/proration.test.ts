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

  it("hourly rate change mid-month: dated hours at each rate; undated hours block", () => {
    const comp = [
      { from: "2020-01-01", to: "2026-10-16", payBasis: "hourly" as const, amountCents: 1_000 },
      { from: "2026-10-16", to: null, payBasis: "hourly" as const, amountCents: 1_200 },
    ];
    // 80 h on 5 Oct at S$10 + 80 h on 20 Oct at S$12 = S$1,760.
    const dated = prorate(
      payInput({
        compensation: comp,
        items: [
          item({ kind: "hours", minutes: 4_800, date: "2026-10-05" }),
          item({ kind: "hours", minutes: 4_800, date: "2026-10-20" }),
        ],
      }),
    );
    expect(dated.issues).toEqual([]);
    expect(dated.basicCents).toBe(176_000);
    expect(dated.lines.filter((l) => l.code === "BASIC").map((l) => [l.amountCents, l.detail])).toEqual([
      [176_000, "80 h × S$10.00; 80 h × S$12.00"],
    ]);
    const undated = prorate(payInput({ compensation: comp, items: [item({ kind: "hours", minutes: 9_600 })] }));
    expect(undated.issues.map((i) => [i.code, i.severity])).toEqual([["HOURLY_RATE_CHANGES_IN_PERIOD", "blocking"]]);
    expect(undated.issues[0]?.message).toMatch(/16 Oct 2026.*date worked/);
    expect(undated.basicCents).toBe(0);
  });

  it("rostered staff: a full month needs nothing, a part month needs roster days (EA s 20A), never an assumed week", () => {
    expect(prorate(payInput({ employment: { pattern: null } })).basicCents).toBe(400_000);
    const missing = prorate(payInput({ employment: { pattern: null, hireDate: "2026-10-16" } }));
    expect(missing.issues.map((i) => [i.code, i.severity])).toEqual([["SCHEDULED_DAYS_REQUIRED", "blocking"]]);
    expect(missing.basicCents).toBe(0);
    // 26 days rostered in October, 12 worked after joining: 4,000 × 12 / 26 = 1,846.153… → 1,846.15.
    const r = prorate(
      payInput({
        employment: { pattern: null, hireDate: "2026-10-16" },
        items: [item({ kind: "scheduled_days", days: 26 }), item({ kind: "days_worked", days: 12 })],
      }),
    );
    expect(r.issues).toEqual([]);
    expect(r.basicCents).toBe(184_615);
    expect(r.lines[0]?.detail).toBe("12 of 26 scheduled days");
    const npl = prorate(payInput({ employment: { pattern: null }, items: [item({ kind: "unpaid_leave", days: 2 })] }));
    expect(npl.issues.map((i) => i.code)).toEqual(["SCHEDULED_DAYS_REQUIRED"]);
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
