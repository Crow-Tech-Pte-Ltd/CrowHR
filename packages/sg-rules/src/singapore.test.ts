import { describe, expect, it } from "vitest";
import { singaporeRules } from "./index.ts";

describe("singaporeRules (CountryRules for SG)", () => {
  it("exposes the Singapore identity and coverage", () => {
    expect(singaporeRules).toMatchObject({ country: "SG", name: "Singapore", currency: "SGD" });
    expect(singaporeRules.coverage).toEqual({ from: "2025-01-01", verifiedOn: "2026-10-31" });
  });

  it("turns employee-months into statutory lines and carries state between months", () => {
    let state = singaporeRules.initialState();
    const common = {
      birthDate: "1990-05-10",
      residency: { status: "SC" as const },
      shgFunds: ["CDAC" as const],
    };
    const jan = singaporeRules.computeEmployeeMonth({
      ...common,
      month: "2026-01",
      owCents: 900_000,
      awCents: 1_200_000,
      totalWagesCents: 2_100_000,
      state,
    });
    expect(jan.ok).toBe(true);
    expect(jan.lines).toEqual([
      { code: "CPF_EMPLOYEE", label: "CPF (employee)", payer: "EMPLOYEE", amountCents: 280_000, remitTo: "CPF Board" },
      { code: "CPF_EMPLOYER", label: "CPF (employer)", payer: "EMPLOYER", amountCents: 238_000, remitTo: "CPF Board" },
      {
        code: "SHG_CDAC",
        label: "CDAC contribution",
        payer: "EMPLOYEE",
        amountCents: 300,
        remitTo: "CPF Board (for CDAC)",
      },
    ]);
    state = jan.stateAfter;
    expect(state.awPayments).toHaveLength(1);

    const employer = singaporeRules.computeEmployerMonth([
      jan,
      singaporeRules.computeEmployeeMonth({
        ...common,
        month: "2026-01",
        owCents: 123_456,
        awCents: 0,
        totalWagesCents: 123_456,
        state: singaporeRules.initialState(),
      }),
    ]);
    expect(employer.lines).toEqual([
      { code: "SDL", label: "Skills Development Levy", payer: "EMPLOYER", amountCents: 1_400, remitTo: "CPF Board" },
    ]);
  });

  it("emits shortfall lines with a recovery warning in the last month of employment", () => {
    const r = singaporeRules.computeEmployeeMonth({
      birthDate: "1990-05-10",
      residency: { status: "SC" },
      shgFunds: [],
      month: "2026-06",
      owCents: 150_000,
      awCents: 0,
      totalWagesCents: 150_000,
      employment: { lastMonth: "2026-06" },
      state: {
        owSubjectCents: 4_000_000,
        awPayments: [{ payableMonth: "2026-02", owCents: 900_000, awPayableCents: 1_200_000, awSubjectCents: 300_000 }],
      },
    });
    expect(r.lines.map((l) => [l.code, l.amountCents])).toEqual([
      ["CPF_EMPLOYEE", 30_000],
      ["CPF_EMPLOYER", 25_500],
      ["CPF_AW_SHORTFALL_EMPLOYEE", 180_000],
      ["CPF_AW_SHORTFALL_EMPLOYER", 153_000],
    ]);
    expect(r.issues.map((i) => i.code)).toContain("CPF_AW_SHORTFALL_EMPLOYEE_RECOVERY");
    expect(r.sdl.exactDollars).toBe("3.75");
  });

  it("returns ok:false, no CPF lines and unchanged state when CPF is blocked", () => {
    const state = {
      owSubjectCents: 180_000,
      awPayments: [{ payableMonth: "2026-01", owCents: 30_000, awPayableCents: 9_840_000, awSubjectCents: 9_840_000 }],
    };
    const r = singaporeRules.computeEmployeeMonth({
      birthDate: "1990-05-10",
      residency: { status: "SC" },
      shgFunds: ["SINDA"],
      shgFixedAmountsCents: { SINDA: 100 },
      sdlExemption: "NO_SERVICE_IN_SINGAPORE",
      month: "2026-07",
      owCents: 30_000,
      awCents: 30_000,
      totalWagesCents: 60_000,
      state,
    });
    expect(r.ok).toBe(false);
    expect(r.stateAfter).toBe(state);
    expect(r.lines.map((l) => l.code)).toEqual(["SHG_SINDA"]);
    expect(r.issues.some((i) => i.severity === "blocking")).toBe(true);
  });
});
