/**
 * IRAS Form IR8A Appendix 8A (benefits-in-kind) and Appendix 8B (gains from ESOP/ESOW plans).
 * Every number below is quoted from the source named next to it; the research record with the full
 * reading is research/sg-ir8a-appendices.md (read 13 Nov 2026). Intervals are [effectiveFrom,
 * effectiveTo) on 1 January of the income year (income year 2026 = Year of Assessment 2027).
 *
 * The rows start at the engine coverage start (income year 2025 = YA2026): the values were verified
 * against the YA2027 documents, and IRAS states the accommodation and car formulas apply "From YA
 * 2020"; earlier years are not claimed.
 */

import { SgRulesInputError } from "../errors.ts";
import type { IsoDate } from "../types.ts";
import { type Effective, pickInForce } from "./effective.ts";

export const IRAS_APPENDIX_SOURCES = {
  /** Explanatory Notes for Form IR8A and Appendix 8A, year ended 31 Dec 2026 (YA2027), items 11–12. */
  explanatoryNotes8a:
    "https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-form-ir8a-and-appendix-8a-for-ya2027.pdf",
  /** Explanatory Notes for Appendix 8B, App8B(1/2027). */
  explanatoryNotes8b:
    "https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-appendix-8b-for-ya2027.pdf",
  /** Appendix 8A form, IR8A(A/1/2027). */
  form8a: "https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/appendix-8a-for-ya2027.doc",
  /** Appendix 8B form, App8B(1/2027). */
  form8b: "https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/appendix-8b-for-ya2027.doc",
  /** AIS-API 2.0 data items v2.5 (30 Jan 2026): sheets <appendix8A>, <appendix8B>, <iR8A>. */
  aisDataItems: "https://file.go.gov.sg/aisapi2-dataitems.xlsx",
  /** IR8A Import Template (sheets Appendix 8A(Accommodation), Appendix 8A(Hotel & Others), Appendix 8B). */
  importTemplate: "https://go.gov.sg/ir8a-import-template",
  accommodation:
    "https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/accommodation-and-related-benefits",
  car: "https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/car-and-car-related-benefits",
  /** IRAS Car Benefit Calculator from YA 2020: sheets NewCar, PteCar, Lease Car; `CarYear` days table. */
  carCalculator: "https://www.iras.gov.sg/docs/default-source/uploadedfiles/xls/car-benefit-tax-cal-from-ya-2020.xlsm",
  airPassage:
    "https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/air-passage",
  loans:
    "https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/benefits-relating-to-loans",
  exemptBenefits:
    "https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/list-of-benefits-in-kind-granted-administrative-concession-or-exempt-from-income-tax",
  /** IRAS e-Tax Guide "Tax Treatment of ESOP and Other Forms of ESOW Plans", 6th edition, 30 Jan 2026. */
  esopGuide: "https://www.iras.gov.sg/docs/default-source/e-tax/etaxguides_iit_esop_2026-01-30.pdf",
} as const;

export interface Appendix8aRule extends Effective {
  /**
   * Furniture and fittings of premises not rented by the employer, in basis points of the annual
   * value for the period: Form 8A 2b "(i) 40% of AV if premises is partially furnished or (ii) 50% of
   * AV if premises is fully furnished"; Accommodation page; AIS item D2(b)(ii).
   */
  readonly furnitureFittingsBps: { readonly partial: number; readonly full: number };
  /**
   * Days in the annual value apportionment. EN-8A item 12 example: "$40,000/2 x 90/365". No source
   * states the divisor for a leap year (research §6.1), so the annual value is not computed then.
   */
  readonly annualValueDayBasis: number;
  /** Car page: "3/7 refers to the use of car outside office hours for private matters". */
  readonly carPrivateUse: { readonly num: number; readonly den: number };
  /** Car page, new car: "(car cost - PARF rebate)/10". */
  readonly newCarYears: number;
  /** Car page, renewed COE: "E … (currently either 5 or 10 years)". */
  readonly coeRenewalYears: readonly number[];
  /** Second-hand car "B", rounded up to whole years (Car Example 3); a COE lasts at most 10 years. */
  readonly maxCoeYears: number;
  /** Template read-me "up to 10 accommodations"; AIS item D1 "up to 10". */
  readonly maxResidencesPerEmployee: number;
  /** Template column H "Max up to 999"; AIS item D1(d) Number (3). */
  readonly maxEmployeesSharing: number;
  /** AIS D-items "Decimals (7,2)"; template "Max 7 Digits and 2 decimals": at most $9,999,999.99. */
  readonly maxAmountCents: number;
}

export const APPENDIX_8A_RULES: readonly Appendix8aRule[] = [
  {
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-11-13",
    source: IRAS_APPENDIX_SOURCES.explanatoryNotes8a,
    furnitureFittingsBps: { partial: 4_000, full: 5_000 },
    annualValueDayBasis: 365,
    carPrivateUse: { num: 3, den: 7 },
    newCarYears: 10,
    coeRenewalYears: [5, 10],
    maxCoeYears: 10,
    maxResidencesPerEmployee: 10,
    maxEmployeesSharing: 999,
    maxAmountCents: 999_999_999,
  },
];

export interface Appendix8bRule extends Effective {
  /**
   * AIS items E2/E3: ESOW, and ESOP granted on or after 1 Jan 2003, are S10(1)(b) (IR8A d7(a)); ESOP
   * granted before 1 Jan 2003 are S10(1)(g) (IR8A d7(b)).
   */
  readonly s101gEsopGrantedBefore: IsoDate;
  /** Template read-me "up to 30 entries"; AIS item E1 "up to 30". */
  readonly maxRecordsPerEmployee: number;
  /** AIS items E1(e)–(g) "Decimals (9,5)"; template "Max 9 digits and 5 Decimals Allowed". */
  readonly decimalPlaces: number;
  readonly maxIntegerDigits: number;
  /** AIS item E1(h) "Decimals (9,2)": at most $999,999,999.99. */
  readonly maxGainCents: number;
}

export const APPENDIX_8B_RULES: readonly Appendix8bRule[] = [
  {
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-11-13",
    source: IRAS_APPENDIX_SOURCES.aisDataItems,
    s101gEsopGrantedBefore: "2003-01-01",
    maxRecordsPerEmployee: 30,
    decimalPlaces: 5,
    maxIntegerDigits: 9,
    maxGainCents: 99_999_999_999,
  },
];

function yearStart(year: number): IsoDate {
  if (!Number.isInteger(year) || year < 1000 || year > 9999)
    throw new SgRulesInputError(`Income year must be a four-digit year, got ${year}.`);
  return `${year}-01-01`;
}

/** The Appendix 8A rules for an income year (1 January of that year). */
export function appendix8aRuleFor(incomeYear: number): Appendix8aRule {
  return pickInForce(APPENDIX_8A_RULES, yearStart(incomeYear), "IRAS Appendix 8A");
}

/** The Appendix 8B rules for an income year (1 January of that year). */
export function appendix8bRuleFor(incomeYear: number): Appendix8bRule {
  return pickInForce(APPENDIX_8B_RULES, yearStart(incomeYear), "IRAS Appendix 8B");
}
