import { SgRulesInputError } from "./errors.ts";
import { parseMonth } from "./internal/dates.ts";
import { assertCents, money } from "./internal/money.ts";
import { SHG_FUNDS, shgTableFor } from "./tables/index.ts";
import { SHG_DETERMINATION_SOURCE, type ShgFund, SINDA_INDIAN_DESCENT_RACES } from "./tables/shg.ts";
import type { Cents, RuleIssue, WorkingStep, YearMonth } from "./types.ts";

export type ShgResidency = "SC" | "SPR" | "FOREIGNER";

export interface ShgDeterminationInput {
  readonly residency: ShgResidency;
  /** Work pass type for foreigners. SINDA covers Employment Pass holders. */
  readonly passType?: "EP" | "S_PASS" | "WORK_PERMIT" | "OTHER";
  /**
   * Race as on the NRIC/FIN, components in order (double-barrelled "Indian-Chinese" → ["Indian", "Chinese"]).
   * Never guess race from a name. Empty = unknown.
   */
  readonly race: readonly string[];
  /** Religion: MBMF applies to Muslims (Administration of Muslim Law Act s 78), in addition to any race fund. */
  readonly isMuslim: boolean;
  readonly elections?: {
    /** Funds the employee has opted out of (opt-out form sent; keep a copy). */
    readonly optedOut?: readonly ShgFund[];
    /** Extra funds the employee chose to give to (e.g. the second race of a double-barrelled race). */
    readonly additional?: readonly ShgFund[];
  };
}

export interface ShgDetermination {
  readonly funds: readonly ShgFund[];
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

function raceFund(race: string): ShgFund | null {
  const r = race.trim().toUpperCase();
  if (r === "CHINESE") return "CDAC";
  if (r === "EURASIAN") return "ECF";
  if (SINDA_INDIAN_DESCENT_RACES.includes(r)) return "SINDA";
  return null;
}

/** Which SHG funds to deduct by default, from race (first race listed), religion, residency and elections. */
export function determineShgFunds(input: ShgDeterminationInput): ShgDetermination {
  const working: WorkingStep[] = [];
  const issues: RuleIssue[] = [];
  const funds = new Set<ShgFund>();
  const local = input.residency === "SC" || input.residency === "SPR";
  const first = input.race[0];
  if (first === undefined || first.trim() === "") {
    if (local || input.passType === "EP") {
      issues.push({
        code: "SHG_RACE_MISSING",
        severity: "warning",
        message:
          "Race is not recorded. Record the race as on the NRIC/FIN (or as declared by the employee) to determine the SHG fund.",
        source: SHG_DETERMINATION_SOURCE,
      });
    }
  } else {
    const fund = raceFund(first);
    if (input.race.length > 1) {
      working.push({
        code: "SHG_DOUBLE_BARRELLED",
        text: `Double-barrelled race ${input.race.join("-")}: the first race listed (${first}) determines the fund.`,
      });
    }
    if (fund === "SINDA" && (local || input.passType === "EP")) {
      funds.add(fund);
      working.push({
        code: "SHG_RACE_FUND",
        text: `${first} (Indian descent), ${local ? input.residency : "Employment Pass holder"} → SINDA.`,
      });
    } else if ((fund === "CDAC" || fund === "ECF") && local) {
      funds.add(fund);
      working.push({ code: "SHG_RACE_FUND", text: `${first}, ${input.residency} → ${fund}.` });
    } else if (fund !== null) {
      working.push({
        code: "SHG_RACE_FUND_NOT_ELIGIBLE",
        text: `${first}: ${fund} applies only to ${fund === "SINDA" ? "SCs, SPRs and EP holders" : "SCs and SPRs"}.`,
      });
    } else {
      working.push({ code: "SHG_NO_RACE_FUND", text: `${first}: no race-based SHG fund.` });
    }
  }
  if (input.isMuslim) {
    funds.add("MBMF");
    working.push({
      code: "SHG_MBMF",
      text: "Muslim → MBMF (SCs, SPRs and foreign employees), in addition to any race fund.",
    });
  }
  for (const f of input.elections?.additional ?? []) {
    funds.add(f);
    working.push({ code: "SHG_ADDITIONAL", text: `Employee elected to also contribute to ${f}.` });
  }
  for (const f of input.elections?.optedOut ?? []) {
    if (funds.delete(f)) {
      working.push({ code: "SHG_OPTED_OUT", text: `Employee opted out of ${f}.` });
      issues.push({
        code: "SHG_OPT_OUT_EVIDENCE",
        severity: "info",
        message: `Keep a copy of the ${f} opt-out form (or MUIS certificate for MBMF) with the employee record.`,
        source: SHG_DETERMINATION_SOURCE,
      });
    }
  }
  const ordered = SHG_FUNDS.filter((f) => funds.has(f));
  if (ordered.length > 1) {
    issues.push({
      code: "SHG_MULTIPLE_FUNDS",
      severity: "info",
      message: `More than one SHG fund applies: ${ordered.join(", ")}.`,
    });
  }
  return { funds: ordered, working, issues };
}

export interface ShgInput {
  readonly month: YearMonth;
  /** Total wages for the month (OW + AW including bonus), no CPF ceilings. */
  readonly totalWagesCents: Cents;
  readonly funds: readonly ShgFund[];
  /** Fixed amounts agreed with the fund (e.g. MUIS certificate, SINDA "fix" form) replace the table amount. */
  readonly fixedAmountsCents?: Partial<Record<ShgFund, Cents>>;
}

export interface ShgResult {
  readonly byFund: Partial<Record<ShgFund, Cents>>;
  readonly totalCents: Cents;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

/** SHG deduction(s) for one employee-month from the published tables by total wages. */
export function computeShg(input: ShgInput): ShgResult {
  parseMonth(input.month, "month");
  assertCents(input.totalWagesCents, "totalWagesCents");
  const byFund: Partial<Record<ShgFund, Cents>> = {};
  const working: WorkingStep[] = [];
  const issues: RuleIssue[] = [];
  if (input.funds.length === 0) return { byFund, totalCents: 0, working, issues };
  if (input.totalWagesCents === 0) {
    working.push({ code: "SHG_NO_WAGES", text: "No wages paid in the month, so no SHG deduction." });
    return { byFund, totalCents: 0, working, issues };
  }
  if (input.totalWagesCents <= 5_000) {
    issues.push({
      code: "SHG_VERY_LOW_WAGES",
      severity: "warning",
      message:
        "Total wages are $50 or less (no CPF). Whether SHG is due is not stated by CPF; the table amount is applied — confirm or override.",
    });
  }
  let total = 0;
  for (const fund of input.funds) {
    if (byFund[fund] !== undefined) throw new SgRulesInputError(`SHG fund ${fund} listed twice.`);
    const fixed = input.fixedAmountsCents?.[fund];
    if (fixed !== undefined) {
      assertCents(fixed, `fixedAmountsCents.${fund}`);
      byFund[fund] = fixed;
      total += fixed;
      working.push({ code: "SHG_FIXED", text: `${fund}: fixed amount ${money(fixed)} as agreed with the fund.` });
      continue;
    }
    const table = shgTableFor(fund, `${input.month}-01`);
    const band = table.bands.find(
      (b) => b.upToInclusiveCents === null || input.totalWagesCents <= b.upToInclusiveCents,
    );
    // The last band is open-ended, so a band always exists.
    const amount = (band as { amountCents: number }).amountCents;
    byFund[fund] = amount;
    total += amount;
    const bandText =
      band?.upToInclusiveCents === null || band === undefined
        ? "top band"
        : `band up to ${money(band.upToInclusiveCents)}`;
    working.push({
      code: "SHG_TABLE",
      text: `${fund}: total wages ${money(input.totalWagesCents)} → ${bandText} → ${money(amount)}.`,
    });
  }
  return { byFund, totalCents: total, working, issues };
}
