import type { CountryRules, EmployeeMonthOutcome, StatutoryLine } from "./country.ts";
import {
  type CpfBlockedResult,
  type CpfMonthInput,
  type CpfMonthResult,
  type CpfYearToDate,
  computeCpf,
} from "./cpf/index.ts";
import { assertCents } from "./internal/money.ts";
import { computeSdl, computeSdlTotal, type SdlResult } from "./sdl.ts";
import { computeShg, type ShgResult } from "./shg.ts";
import { ENGINE_COVERAGE_START, RULES_VERIFIED_ON } from "./tables/effective.ts";
import type { SdlExemption } from "./tables/sdl.ts";
import type { ShgFund } from "./tables/shg.ts";
import type { Cents, RuleIssue } from "./types.ts";

export interface SgEmployeeMonthInput extends Omit<CpfMonthInput, "yearToDate" | "contributionMonth"> {
  readonly month: CpfMonthInput["contributionMonth"];
  /** Per-employee state from last month (or `singaporeRules.initialState()` in January / on joining). */
  readonly state: CpfYearToDate;
  /**
   * All wages paid or payable for the month (OW + AW, no ceilings), for SDL and SHG. Usually
   * owCents + awCents; larger in an SPR conversion month (pre-conversion OW is not CPF-liable but
   * is still wages for SDL/SHG).
   */
  readonly totalWagesCents: Cents;
  readonly shgFunds: readonly ShgFund[];
  readonly shgFixedAmountsCents?: Partial<Record<ShgFund, Cents>>;
  readonly sdlExemption?: SdlExemption;
}

export interface SgEmployeeMonthOutcome extends EmployeeMonthOutcome<CpfYearToDate> {
  readonly cpf: CpfMonthResult | CpfBlockedResult;
  readonly sdl: SdlResult;
  readonly shg: ShgResult;
}

const CPF = "CPF Board";

function cpfLines(cpf: CpfMonthResult): StatutoryLine[] {
  const lines: StatutoryLine[] = [
    { code: "CPF_EMPLOYEE", label: "CPF (employee)", payer: "EMPLOYEE", amountCents: cpf.employeeCents, remitTo: CPF },
    { code: "CPF_EMPLOYER", label: "CPF (employer)", payer: "EMPLOYER", amountCents: cpf.employerCents, remitTo: CPF },
  ];
  const s = cpf.priorAw.shortfall;
  if (s) {
    lines.push(
      {
        code: "CPF_AW_SHORTFALL_EMPLOYEE",
        label: "CPF on earlier AW (employee)",
        payer: "EMPLOYEE",
        amountCents: s.employeeCents,
        remitTo: CPF,
      },
      {
        code: "CPF_AW_SHORTFALL_EMPLOYER",
        label: "CPF on earlier AW (employer)",
        payer: "EMPLOYER",
        amountCents: s.employerCents,
        remitTo: CPF,
      },
    );
  }
  return lines.filter((l) => l.amountCents !== 0);
}

/** Singapore statutory rules: CPF, SHG (employee) and SDL (employer, aggregated). */
export const singaporeRules: CountryRules<SgEmployeeMonthInput, CpfYearToDate, SgEmployeeMonthOutcome> = {
  country: "SG",
  name: "Singapore",
  currency: "SGD",
  coverage: { from: ENGINE_COVERAGE_START, verifiedOn: RULES_VERIFIED_ON },
  initialState: () => ({ owSubjectCents: 0, awPayments: [] }),
  computeEmployeeMonth(input) {
    assertCents(input.totalWagesCents, "totalWagesCents");
    const { month, state, totalWagesCents, shgFunds, shgFixedAmountsCents, sdlExemption, ...cpfInput } = input;
    const cpf = computeCpf({ ...cpfInput, contributionMonth: month, yearToDate: state });
    const sdl = computeSdl({ month, totalWagesCents, ...(sdlExemption ? { exemption: sdlExemption } : {}) });
    const shg = computeShg({
      month,
      totalWagesCents,
      funds: shgFunds,
      ...(shgFixedAmountsCents ? { fixedAmountsCents: shgFixedAmountsCents } : {}),
    });
    const issues: RuleIssue[] = [...cpf.issues, ...sdl.issues, ...shg.issues];
    if (cpf.ok && cpf.priorAw.shortfall && cpf.priorAw.shortfall.employeeCents > 0) {
      issues.push({
        code: "CPF_AW_SHORTFALL_EMPLOYEE_RECOVERY",
        severity: "warning",
        message:
          "The employee share of CPF on earlier AW is payable now. Confirm before recovering it from this month's wages: the CPF Act s 7 recovery rules were not verified.",
      });
    }
    const shgLines: StatutoryLine[] = Object.entries(shg.byFund).map(([fund, amount]) => ({
      code: `SHG_${fund}`,
      label: `${fund} contribution`,
      payer: "EMPLOYEE",
      amountCents: amount as number,
      remitTo: `${CPF} (for ${fund})`,
    }));
    return {
      ok: cpf.ok,
      lines: [...(cpf.ok ? cpfLines(cpf) : []), ...shgLines],
      working: [...cpf.working, ...sdl.working, ...shg.working],
      issues,
      stateAfter: cpf.ok ? cpf.yearToDateAfter : state,
      cpf,
      sdl,
      shg,
    };
  },
  computeEmployerMonth(outcomes) {
    const total = computeSdlTotal(outcomes.map((o) => o.sdl));
    return {
      lines: [
        {
          code: "SDL",
          label: "Skills Development Levy",
          payer: "EMPLOYER",
          amountCents: total.payableCents,
          remitTo: CPF,
        },
      ],
      working: total.working,
    };
  },
};
