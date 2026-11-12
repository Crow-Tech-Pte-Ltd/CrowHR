import { RulesNotAvailableError, SgRulesInputError } from "../errors.ts";
import { epochDay, parseDate } from "../internal/dates.ts";
import { type ExactCents, exactCents, exactDollarsText, floorToCent } from "../internal/exact.ts";
import { money } from "../internal/money.ts";
import { type Appendix8aRule, appendix8aRuleFor, IRAS_APPENDIX_SOURCES as SRC } from "../tables/iras-appendices.ts";
import type { Cents, IsoDate, RuleIssue, WorkingStep } from "../types.ts";

/**
 * Appendix 8A (value of benefits-in-kind), research/sg-ir8a-appendices.md §2. Values IRAS gives a
 * formula for are computed exactly and rounded down to the cent (`floorToCent`): IRAS publishes no
 * rounding rule, and its own example truncates ($40,000/2 × 90/365 = $4,931.5068… shown as
 * $4,931.50). Everything else is the amount the employer enters. The IR8A d8 total drops the
 * decimals (AIS item C20).
 */

export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = (y: number): number => (isLeapYear(y) ? 366 : 365);

/** "$4,931.50", or "≈$4,931.506849" for a non-terminating exact amount. */
const exactText = (x: ExactCents) => {
  const t = exactDollarsText(x);
  return t.startsWith("≈") ? `≈$${t.slice(1)}` : `$${t}`;
};

function checkAmount(value: number, label: string, rule: Appendix8aRule): void {
  if (!Number.isSafeInteger(value)) throw new SgRulesInputError(`${label} must be integer cents, got ${value}.`);
  if (value < 0) throw new SgRulesInputError(`${label} must not be negative: enter the amount the employer bore.`);
  if (value > rule.maxAmountCents)
    throw new SgRulesInputError(
      `${label} is more than the ${money(rule.maxAmountCents)} IRAS's Appendix 8A accepts per item. Check the amount.`,
    );
}

/** Days from `from` to `to`, both counted (EN-8A: 1 Mar to 29 May 2026 = 90 days), inside the income year. */
export function occupationDays(incomeYear: number, from: IsoDate, to: IsoDate, what = "The period"): number {
  parseDate(from, "start date");
  parseDate(to, "end date");
  if (from.slice(0, 4) !== String(incomeYear) || to.slice(0, 4) !== String(incomeYear))
    throw new SgRulesInputError(
      `${what} must be in ${incomeYear}: Appendix 8A reports one income year. Split a period that crosses the year into one record per year.`,
    );
  if (from > to) throw new SgRulesInputError(`${what} must start on or before the day it ends.`);
  return epochDay(to) - epochDay(from) + 1;
}

// ---------------------------------------------------------------------------------------------
// Items 1–2: place of residence, utilities and housekeeping
// ---------------------------------------------------------------------------------------------

/**
 * - `rented`: rented by the employer; taxable value is the rent (including furniture and fittings).
 * - `owned`: not rented by the employer; annual value plus 40% or 50% furniture and fittings.
 * - `none`: no place of residence, only utilities, a driver or a servant (items 2g–2i).
 * Accommodation page, "Taxable Value of Accommodation Benefits" and FAQ.
 */
export type ResidenceBasis = "rented" | "owned" | "none";
export type Furnishing = "partial" | "full";

export interface DriverInput {
  /** Annual wages of the driver borne by the employer. */
  readonly annualCostCents: Cents;
  /** Private (non-business) mileage. */
  readonly personalKm: number;
  readonly totalKm: number;
}

export interface ResidenceInput {
  readonly incomeYear: number;
  readonly basis: ResidenceBasis;
  /** Period of occupation in the income year; required unless `basis` is `none`. */
  readonly occupiedFrom: IsoDate | null;
  readonly occupiedTo: IsoDate | null;
  /** Employees sharing the premises, excluding family members who are not employees (1 if not shared). */
  readonly employeesSharing: number;
  /** `rented`: rent paid by the employer for the period, including furniture and fittings, whole premises. */
  readonly rentPaidByEmployerCents?: Cents | null;
  /** `owned`: the premises' annual value (property tax bill or IRAS e-Valuation List). */
  readonly annualValueCents?: Cents | null;
  /** `owned`: 2a entered instead of computed (annual value revised during the year, or a leap year). */
  readonly annualValueForPeriodCents?: Cents | null;
  readonly furnishing?: Furnishing | null;
  /** 2e: total rent paid by the employee. */
  readonly rentPaidByEmployeeCents: Cents;
  /** 2g: utilities, telephone, suitcase, golf bag, camera, electronic gadgets (actual amount). */
  readonly utilitiesCents: Cents;
  /** 2h: driver (annual cost × private ÷ total mileage). */
  readonly driver?: DriverInput | null;
  /** 2i: servant, gardener, upkeep of compound (annual wages or amount paid to a company). */
  readonly servantCents: Cents;
}

export interface ResidenceResult {
  readonly days: number | null;
  /** 2a: annual value for the period, apportioned (owned premises). */
  readonly annualValueForPeriodCents: Cents | null;
  readonly annualValueEntered: boolean;
  /** 2b: furniture and fittings (owned premises). */
  readonly furnitureFittingsCents: Cents | null;
  /** 2c: rent paid by the employer, apportioned between employees sharing (rented premises). */
  readonly rentPaidByEmployerCents: Cents | null;
  /** 2d: (2a + 2b) or 2c. */
  readonly residenceValueCents: Cents;
  /** 2e. */
  readonly rentPaidByEmployeeCents: Cents;
  /** 2f: 2d − 2e, not below zero. */
  readonly residenceTaxableCents: Cents;
  readonly utilitiesCents: Cents;
  readonly driverCents: Cents;
  readonly servantCents: Cents;
  /** 2j: 2g + 2h + 2i. */
  readonly householdCents: Cents;
  /** 2f + 2j. */
  readonly totalCents: Cents;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

const present = (v: number | null | undefined): v is number => v !== null && v !== undefined;

export function computeResidenceBenefit(input: ResidenceInput): ResidenceResult {
  const rule = appendix8aRuleFor(input.incomeYear);
  const year = input.incomeYear;
  const working: WorkingStep[] = [];
  const issues: RuleIssue[] = [];
  const sharing = input.employeesSharing;
  if (!Number.isInteger(sharing) || sharing < 1 || sharing > rule.maxEmployeesSharing)
    throw new SgRulesInputError(
      `Employees sharing the premises must be a whole number from 1 to ${rule.maxEmployeesSharing} (1 if not shared; family members who are not employees don't count).`,
    );
  checkAmount(input.rentPaidByEmployeeCents, "Rent paid by the employee", rule);
  checkAmount(input.utilitiesCents, "Utilities and gadgets", rule);
  checkAmount(input.servantCents, "Servant, gardener or upkeep", rule);

  let days: number | null = null;
  let annualValue: Cents | null = null;
  let annualValueEntered = false;
  let furniture: Cents | null = null;
  let rent: Cents | null = null;
  let residenceValue = 0;

  if (input.basis === "none") {
    if (
      input.occupiedFrom ||
      input.occupiedTo ||
      present(input.rentPaidByEmployerCents) ||
      present(input.annualValueCents) ||
      present(input.annualValueForPeriodCents) ||
      input.furnishing ||
      input.rentPaidByEmployeeCents > 0
    )
      throw new SgRulesInputError(
        "This record has no place of residence: leave the period, rent, annual value and furnishing empty, or choose whether the employer rented or owns the premises.",
      );
  } else {
    if (!input.occupiedFrom || !input.occupiedTo)
      throw new SgRulesInputError("Enter the period of occupation: the first and last day the employee lived there.");
    days = occupationDays(year, input.occupiedFrom, input.occupiedTo, "The period of occupation");
    working.push({
      code: "A8A_DAYS",
      text: `Occupied ${input.occupiedFrom} to ${input.occupiedTo}: ${days} days (both ends counted).`,
    });
    if (input.basis === "rented") {
      if (present(input.annualValueCents) || present(input.annualValueForPeriodCents) || input.furnishing)
        throw new SgRulesInputError(
          "Premises rented by the employer are valued at the rent paid, which includes furniture and fittings: leave the annual value and furnishing empty.",
        );
      if (!present(input.rentPaidByEmployerCents))
        throw new SgRulesInputError(
          "Enter the rent the employer paid for the period, including any rent for furniture and fittings.",
        );
      checkAmount(input.rentPaidByEmployerCents, "Rent paid by the employer", rule);
      const exact = exactCents(input.rentPaidByEmployerCents, sharing);
      rent = floorToCent(exact);
      residenceValue = rent;
      working.push({
        code: "A8A_2C_RENT",
        text:
          sharing === 1
            ? `2c rent paid by the employer (including furniture and fittings) = ${money(rent)}.`
            : `2c rent paid by the employer = ${money(input.rentPaidByEmployerCents)} ÷ ${sharing} employees sharing = ${exactText(exact)} → ${money(rent)} (rounded down to the cent).`,
      });
    } else {
      if (present(input.rentPaidByEmployerCents))
        throw new SgRulesInputError(
          "Premises the employer owns (pays no rent for) are valued at their annual value: leave the rent paid by the employer empty, or choose 'rented'.",
        );
      if (!input.furnishing)
        throw new SgRulesInputError(
          "Choose whether the premises are partly furnished (fittings only, such as lights, air-conditioning or a water heater) or fully furnished.",
        );
      if (present(input.annualValueCents) && present(input.annualValueForPeriodCents))
        throw new SgRulesInputError(
          "Enter either the premises' annual value (Crow HR apportions it) or the annual value for the period, not both.",
        );
      if (present(input.annualValueForPeriodCents)) {
        checkAmount(input.annualValueForPeriodCents, "Annual value for the period", rule);
        annualValue = input.annualValueForPeriodCents;
        annualValueEntered = true;
        working.push({
          code: "A8A_2A_ANNUAL_VALUE",
          text: `2a annual value for the period (entered) = ${money(annualValue)}.`,
        });
      } else {
        if (!present(input.annualValueCents))
          throw new SgRulesInputError(
            "Enter the premises' annual value (on the property tax bill or IRAS's e-Valuation List), or the annual value for the period.",
          );
        checkAmount(input.annualValueCents, "Annual value", rule);
        if (isLeapYear(year))
          throw new RulesNotAvailableError(
            `IRAS has not published how to apportion the annual value in a leap year (${year} has 366 days). Enter the annual value for the period (2a) yourself.`,
          );
        const exact = exactCents(
          BigInt(input.annualValueCents) * BigInt(days),
          BigInt(sharing * rule.annualValueDayBasis),
        );
        annualValue = floorToCent(exact);
        working.push({
          code: "A8A_2A_ANNUAL_VALUE",
          text: `2a annual value for the period = ${money(input.annualValueCents)} ÷ ${sharing} employee${sharing === 1 ? "" : "s"} sharing × ${days} ÷ ${rule.annualValueDayBasis} days = ${exactText(exact)} → ${money(annualValue)} (rounded down to the cent).`,
        });
      }
      const bps = rule.furnitureFittingsBps[input.furnishing];
      furniture = floorToCent(exactCents(BigInt(annualValue) * BigInt(bps), 10_000n));
      residenceValue = annualValue + furniture;
      working.push({
        code: "A8A_2B_FURNITURE",
        text: `2b furniture and fittings = ${bps / 100}% (${input.furnishing === "full" ? "fully" : "partly"} furnished) × ${money(annualValue)} = ${money(furniture)}.`,
      });
    }
  }
  checkAmount(residenceValue, "The value of the residence (2d)", rule);
  const residenceTaxable = Math.max(0, residenceValue - input.rentPaidByEmployeeCents);
  if (input.basis !== "none") {
    working.push({
      code: "A8A_2F_RESIDENCE",
      text: `2f taxable value of the residence = ${money(residenceValue)} − ${money(input.rentPaidByEmployeeCents)} paid by the employee = ${money(residenceTaxable)}.`,
    });
    if (input.rentPaidByEmployeeCents > residenceValue)
      issues.push({
        code: "A8A_2F_CLAMPED",
        severity: "info",
        message: "The employee paid more rent than the residence is worth, so its taxable value is $0.00.",
        source: SRC.aisDataItems,
      });
  }

  let driver = 0;
  if (input.driver) {
    const d = input.driver;
    checkAmount(d.annualCostCents, "The driver's annual cost", rule);
    if (!Number.isSafeInteger(d.totalKm) || d.totalKm <= 0)
      throw new SgRulesInputError("Enter the car's total mileage for the year (more than 0 km) to value the driver.");
    if (!Number.isSafeInteger(d.personalKm) || d.personalKm < 0 || d.personalKm > d.totalKm)
      throw new SgRulesInputError("The private mileage must be a whole number of km from 0 to the total mileage.");
    const exact = exactCents(BigInt(d.annualCostCents) * BigInt(d.personalKm), BigInt(d.totalKm));
    driver = floorToCent(exact);
    working.push({
      code: "A8A_2H_DRIVER",
      text: `2h driver = ${money(d.annualCostCents)} × ${d.personalKm} km private ÷ ${d.totalKm} km total = ${exactText(exact)} → ${money(driver)}.`,
    });
  }
  const household = input.utilitiesCents + driver + input.servantCents;
  if (input.basis === "none" && household === 0)
    throw new SgRulesInputError(
      "Nothing to report: enter utilities, a driver or a servant, or choose a place of residence.",
    );
  checkAmount(household, "Utilities and housekeeping (2j)", rule);
  working.push({
    code: "A8A_2J",
    text: `2j utilities and housekeeping = ${money(input.utilitiesCents)} + ${money(driver)} driver + ${money(input.servantCents)} servant = ${money(household)}.`,
  });
  return {
    days,
    annualValueForPeriodCents: annualValue,
    annualValueEntered,
    furnitureFittingsCents: furniture,
    rentPaidByEmployerCents: rent,
    residenceValueCents: residenceValue,
    rentPaidByEmployeeCents: input.rentPaidByEmployeeCents,
    residenceTaxableCents: residenceTaxable,
    utilitiesCents: input.utilitiesCents,
    driverCents: driver,
    servantCents: input.servantCents,
    householdCents: household,
    totalCents: residenceTaxable + household,
    working,
    issues,
  };
}

// ---------------------------------------------------------------------------------------------
// Item 3: hotel accommodation
// ---------------------------------------------------------------------------------------------

export interface HotelInput {
  /** 3a: actual cost to the employer (hotel, or serviced apartment within a hotel building). */
  readonly costCents: Cents;
  /** 3b: amount the employee paid. */
  readonly paidByEmployeeCents: Cents;
}

export interface HotelResult extends HotelInput {
  /** 3c: 3a − 3b. */
  readonly taxableCents: Cents;
  readonly working: readonly WorkingStep[];
}

/** Accommodation page, Example 4: "the actual costs incurred by the employer less amount paid by employee". */
export function computeHotelBenefit(input: HotelInput, incomeYear: number): HotelResult {
  const rule = appendix8aRuleFor(incomeYear);
  checkAmount(input.costCents, "The hotel cost", rule);
  checkAmount(input.paidByEmployeeCents, "The amount the employee paid", rule);
  if (input.paidByEmployeeCents > input.costCents)
    throw new SgRulesInputError(
      "The employee paid more than the stay cost, so there is nothing to report: check the amounts or delete the record.",
    );
  const taxable = input.costCents - input.paidByEmployeeCents;
  return {
    ...input,
    taxableCents: taxable,
    working: [
      {
        code: "A8A_3C_HOTEL",
        text: `3c hotel accommodation = ${money(input.costCents)} − ${money(input.paidByEmployeeCents)} paid by the employee = ${money(taxable)}.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Item 4i: car benefit
// ---------------------------------------------------------------------------------------------

/** Car page, "Car Provided by Employer: Taxable Value of Car Benefits" A–D. */
export type CarKind = "new" | "second_hand" | "renewed_coe" | "leased";

export interface CarInput {
  readonly incomeYear: number;
  readonly kind: CarKind;
  readonly usedFrom: IsoDate;
  readonly usedTo: IsoDate;
  /**
   * `new` / `second_hand`: acquisition cost including COE paid or payable at purchase.
   * `renewed_coe`: the amount paid to renew the COE (C).
   */
  readonly costCents?: Cents | null;
  /**
   * `new` / `second_hand`: PARF rebate on de-registration at above 9 but not more than 10 years (0
   * for a second-hand car over 10 years old at purchase). `renewed_coe`: the PARF rebate forgone by
   * renewing (D).
   */
  readonly parfRebateCents?: Cents | null;
  /** `second_hand`: years from purchase to COE expiry, rounded up (B). `renewed_coe`: renewed COE years (E). */
  readonly coeYears?: number | null;
  /** `leased`: rental cost the employer incurred for the period. */
  readonly rentalCents?: Cents | null;
  /** Road tax, petrol, parking, ERP, insurance, repairs borne by the employer, including reimbursements. */
  readonly runningCostsCents: Cents;
}

export interface CarResult {
  readonly kind: CarKind;
  readonly days: number;
  readonly daysInYear: number;
  readonly valueCents: Cents;
  readonly working: readonly WorkingStep[];
}

export function computeCarBenefit(input: CarInput): CarResult {
  const rule = appendix8aRuleFor(input.incomeYear);
  const year = input.incomeYear;
  const days = occupationDays(year, input.usedFrom, input.usedTo, "The period the car was provided");
  // IRAS's car benefit calculator: depreciation × days ÷ VLOOKUP(year, CarYear) (366 in a leap year).
  const diy = daysInYear(year);
  checkAmount(input.runningCostsCents, "Running costs", rule);
  const { num, den } = rule.carPrivateUse;
  const working: WorkingStep[] = [
    { code: "A8A_4I_DAYS", text: `Car provided ${input.usedFrom} to ${input.usedTo}: ${days} of ${diy} days.` },
  ];
  let exact: ExactCents;
  if (input.kind === "leased") {
    if (present(input.costCents) || present(input.parfRebateCents) || present(input.coeYears))
      throw new SgRulesInputError(
        "A leased car has no car cost, PARF rebate or COE years: enter the rental and running costs only.",
      );
    if (!present(input.rentalCents))
      throw new SgRulesInputError("Enter the rental the employer paid for the leased car for the period.");
    checkAmount(input.rentalCents, "Rental", rule);
    exact = exactCents(BigInt(num) * BigInt(input.rentalCents + input.runningCostsCents), BigInt(den));
    working.push({
      code: "A8A_4I_LEASED",
      text: `4i leased car = ${num}/${den} × (${money(input.rentalCents)} rental + ${money(input.runningCostsCents)} running costs) = ${exactText(exact)}.`,
    });
  } else {
    if (present(input.rentalCents))
      throw new SgRulesInputError("Rental applies to a leased car only: choose 'leased' or leave the rental empty.");
    if (!present(input.costCents))
      throw new SgRulesInputError(
        input.kind === "renewed_coe"
          ? "Enter the amount the employer paid to renew the COE."
          : "Enter the car cost: the acquisition cost including COE paid or payable at purchase.",
      );
    checkAmount(input.costCents, input.kind === "renewed_coe" ? "The COE renewal amount" : "The car cost", rule);
    const parf = input.parfRebateCents ?? 0;
    checkAmount(parf, "The PARF rebate", rule);
    let years: number;
    let base: number;
    let label: string;
    if (input.kind === "new") {
      if (present(input.coeYears))
        throw new SgRulesInputError(
          `A new car is written off over ${rule.newCarYears} years: leave the COE years empty, or choose 'second-hand'.`,
        );
      years = rule.newCarYears;
      if (parf > input.costCents) throw new SgRulesInputError("The PARF rebate cannot be more than the car cost.");
      base = input.costCents - parf;
      label = `(${money(input.costCents)} − ${money(parf)} PARF rebate) ÷ ${years}`;
    } else if (input.kind === "second_hand") {
      const b = input.coeYears;
      if (!present(b) || !Number.isInteger(b) || b < 1 || b > rule.maxCoeYears)
        throw new SgRulesInputError(
          `Enter the years from purchase to COE expiry, rounded up to a whole number from 1 to ${rule.maxCoeYears} (IRAS: 6 years 2 months counts as 7).`,
        );
      years = b;
      if (parf > input.costCents) throw new SgRulesInputError("The PARF rebate cannot be more than the car cost.");
      base = input.costCents - parf;
      label = `(${money(input.costCents)} − ${money(parf)} PARF rebate) ÷ ${years} years to COE expiry`;
    } else {
      const e = input.coeYears;
      if (!present(e) || !rule.coeRenewalYears.includes(e))
        throw new SgRulesInputError(`Enter the renewed COE's term: ${rule.coeRenewalYears.join(" or ")} years.`);
      years = e;
      base = input.costCents + parf;
      label = `(${money(input.costCents)} renewal + ${money(parf)} PARF rebate forgone) ÷ ${years} years`;
    }
    // num/den × (base × days / (years × diy) + running), exactly.
    exact = exactCents(
      BigInt(num) * (BigInt(base) * BigInt(days) + BigInt(input.runningCostsCents) * BigInt(years * diy)),
      BigInt(den) * BigInt(years * diy),
    );
    working.push({
      code: "A8A_4I_CAR",
      text: `4i car = ${num}/${den} × [${label} × ${days}/${diy} days + ${money(input.runningCostsCents)} running costs] = ${exactText(exact)}.`,
    });
  }
  const value = floorToCent(exact);
  checkAmount(value, "The car benefit", rule);
  working.push({ code: "A8A_4I_VALUE", text: `Car benefit ${money(value)} (rounded down to the cent).` });
  return { kind: input.kind, days, daysInYear: diy, valueCents: value, working };
}

// ---------------------------------------------------------------------------------------------
// Item 4 others and the Appendix 8A total
// ---------------------------------------------------------------------------------------------

/**
 * Items of Appendix 8A section 4 entered as amounts (Form 8A): 4a home leave passages (full cost from
 * YA 2018, Air Passage page), 4b interest benefits (Loans page), 4c insurance premiums, 4d free or
 * subsidised holidays, 4e educational expenses, 4f club fees, 4g gains from assets sold below market
 * value, 4h full cost of a motor vehicle given, 4j other non-monetary awards. 4i is computed above.
 */
export const APPENDIX_8A_ENTERED_ITEMS = ["4a", "4b", "4c", "4d", "4e", "4f", "4g", "4h", "4j"] as const;
export type Appendix8aEnteredItem = (typeof APPENDIX_8A_ENTERED_ITEMS)[number];
export type Appendix8aItem = Appendix8aEnteredItem | "4i";

export interface Appendix8aTotal {
  /** Σ 2f over the places of residence. */
  readonly residenceCents: Cents;
  /** Σ 2j. */
  readonly householdCents: Cents;
  readonly hotel: { readonly costCents: Cents; readonly paidByEmployeeCents: Cents; readonly taxableCents: Cents };
  readonly items: Readonly<Record<Appendix8aItem, Cents>>;
  /** AIS item D5: 2f* + 2j* + 3c + 4a to 4j. */
  readonly totalCents: Cents;
  /** IR8A d8: the total with the decimals dropped (AIS item C20). */
  readonly ir8aD8Dollars: number;
  readonly issues: readonly RuleIssue[];
}

export function totalAppendix8a(
  parts: {
    residences?: readonly Pick<ResidenceResult, "residenceTaxableCents" | "householdCents">[];
    hotels?: readonly HotelInput[];
    cars?: readonly Pick<CarResult, "valueCents">[];
    others?: readonly { item: Appendix8aEnteredItem; amountCents: Cents }[];
  },
  incomeYear: number,
): Appendix8aTotal {
  const rule = appendix8aRuleFor(incomeYear);
  const residences = parts.residences ?? [];
  const items = Object.fromEntries([...APPENDIX_8A_ENTERED_ITEMS, "4i"].map((i) => [i, 0])) as Record<
    Appendix8aItem,
    number
  >;
  for (const o of parts.others ?? []) {
    if (!(APPENDIX_8A_ENTERED_ITEMS as readonly string[]).includes(o.item))
      throw new SgRulesInputError(`Unknown Appendix 8A item "${o.item}".`);
    checkAmount(o.amountCents, `Item ${o.item}`, rule);
    items[o.item] += o.amountCents;
  }
  for (const c of parts.cars ?? []) items["4i"] += c.valueCents;
  const hotelCost = (parts.hotels ?? []).reduce((n, h) => n + h.costCents, 0);
  const hotelPaid = (parts.hotels ?? []).reduce((n, h) => n + h.paidByEmployeeCents, 0);
  const hotel = {
    costCents: hotelCost,
    paidByEmployeeCents: hotelPaid,
    taxableCents: Math.max(0, hotelCost - hotelPaid),
  };
  const residenceCents = residences.reduce((n, r) => n + r.residenceTaxableCents, 0);
  const householdCents = residences.reduce((n, r) => n + r.householdCents, 0);
  const totalCents =
    residenceCents + householdCents + hotel.taxableCents + Object.values(items).reduce((n, v) => n + v, 0);
  const issues: RuleIssue[] = [];
  const fields = { "3a": hotelCost, "3b": hotelPaid, ...items, total: totalCents };
  for (const [field, v] of Object.entries(fields))
    if (v > rule.maxAmountCents)
      issues.push({
        code: "A8A_FIELD_TOO_LARGE",
        severity: "blocking",
        message: `Appendix 8A ${field} is ${money(v)}, more than the ${money(rule.maxAmountCents)} IRAS's form accepts. Enter it in myTax and check it with IRAS.`,
        source: SRC.aisDataItems,
      });
  return {
    residenceCents,
    householdCents,
    hotel,
    items,
    totalCents,
    ir8aD8Dollars: Math.floor(totalCents / 100),
    issues,
  };
}
