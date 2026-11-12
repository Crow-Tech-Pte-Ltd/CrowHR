import {
  type Appendix8aEnteredItem,
  type Appendix8aTotal,
  type Appendix8bTotal,
  type CarResult,
  computeCarBenefit,
  computeHotelBenefit,
  computeResidenceBenefit,
  computeShareGain,
  type HotelResult,
  type ResidenceResult,
  type RuleIssue,
  RulesNotAvailableError,
  SgRulesInputError,
  type ShareGainResult,
  totalAppendix8a,
  totalAppendix8b,
  type WorkingStep,
} from "@crowhr/sg-rules";
import { AppError } from "../../errors.ts";
import { centsToDecimal } from "../../export/cells.ts";
import { ir8aCsvCell } from "./ir8a.ts";
import { type AppendixEntryDetails, OTHER_BENEFIT_ITEMS } from "./ir8a-appendix-input.ts";

/**
 * Appendix 8A and 8B values for the entries HR recorded (add-ir8a-appendix-8a-8b), and their rows in
 * the column layout of IRAS's IR8A Import Template (https://go.gov.sg/ir8a-import-template, sheets
 * `Appendix 8A(Accommodation)`, `Appendix 8A(Hotel & Others)` and `Appendix 8B`). Crow HR does not
 * fill or redistribute the workbook (research/sg-ir8a-appendices.md §4).
 */

export type AppendixLine = { code: string; label: string; amountCents: number | null; entered: boolean };

export interface EntryComputation {
  appendix: "8A" | "8B";
  /** Appendix item the entry reports: "2" (residence), "3", "4a"…"4j", or "8B". */
  item: string;
  /** Contribution to the Appendix 8A total, or the Appendix 8B gross gain. */
  valueCents: number;
  days: number | null;
  section: "S10_1_B" | "S10_1_G" | null;
  lines: AppendixLine[];
  working: WorkingStep[];
  issues: RuleIssue[];
  residence?: ResidenceResult;
  hotel?: HotelResult;
  car?: CarResult;
  share?: ShareGainResult;
}

/** sg-rules refusals become validation errors with sg-rules' how-to-fix message. */
function rules<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SgRulesInputError || err instanceof RulesNotAvailableError)
      throw new AppError("validation_failed", err.message);
    throw err;
  }
}

const line = (code: string, label: string, amountCents: number | null, entered = false): AppendixLine => ({
  code,
  label,
  amountCents,
  entered,
});

/** Computes one entry with the rules in force for `year`; throws `validation_failed` on bad input. */
export function computeEntry(d: AppendixEntryDetails, year: number, today: string): EntryComputation {
  switch (d.kind) {
    case "residence": {
      const r = rules(() =>
        computeResidenceBenefit({
          incomeYear: year,
          basis: d.basis,
          occupiedFrom: d.occupiedFrom,
          occupiedTo: d.occupiedTo,
          employeesSharing: d.employeesSharing,
          rentPaidByEmployerCents: d.rentPaidByEmployerCents,
          annualValueCents: d.annualValueCents,
          annualValueForPeriodCents: d.annualValueForPeriodCents,
          furnishing: d.furnishing,
          rentPaidByEmployeeCents: d.rentPaidByEmployeeCents,
          utilitiesCents: d.utilitiesCents,
          driver:
            d.driverAnnualCostCents > 0 || d.driverTotalKm || d.driverPersonalKm
              ? {
                  annualCostCents: d.driverAnnualCostCents,
                  personalKm: d.driverPersonalKm ?? 0,
                  totalKm: d.driverTotalKm ?? 0,
                }
              : null,
          servantCents: d.servantCents,
        }),
      );
      if (d.basis !== "none" && !d.address)
        throw new AppError("validation_failed", "Enter the address of the place of residence.");
      const lines: AppendixLine[] = [];
      if (d.basis === "owned") {
        lines.push(line("2a", "Annual value for the period", r.annualValueForPeriodCents, r.annualValueEntered));
        lines.push(line("2b", "Furniture and fittings", r.furnitureFittingsCents));
      }
      if (d.basis === "rented") lines.push(line("2c", "Rent paid by the employer", r.rentPaidByEmployerCents));
      if (d.basis !== "none")
        lines.push(
          line("2d", "Value of the residence", r.residenceValueCents),
          line("2e", "Rent paid by the employee", r.rentPaidByEmployeeCents, true),
          line("2f", "Taxable value of the residence", r.residenceTaxableCents),
        );
      lines.push(
        line("2g", "Utilities and gadgets", r.utilitiesCents, true),
        line("2h", "Driver", r.driverCents),
        line("2i", "Servant, gardener or upkeep", r.servantCents, true),
        line("2j", "Utilities and housekeeping", r.householdCents),
      );
      return {
        appendix: "8A",
        item: "2",
        valueCents: r.totalCents,
        days: r.days,
        section: null,
        lines,
        working: [...r.working],
        issues: [...r.issues],
        residence: r,
      };
    }
    case "hotel": {
      const h = rules(() =>
        computeHotelBenefit({ costCents: d.costCents, paidByEmployeeCents: d.paidByEmployeeCents }, year),
      );
      return {
        appendix: "8A",
        item: "3",
        valueCents: h.taxableCents,
        days: null,
        section: null,
        lines: [
          line("3a", "Actual cost of the hotel", h.costCents, true),
          line("3b", "Amount paid by the employee", h.paidByEmployeeCents, true),
          line("3c", "Taxable value of the hotel stay", h.taxableCents),
        ],
        working: [...h.working],
        issues: [],
        hotel: h,
      };
    }
    case "car": {
      const c = rules(() =>
        computeCarBenefit({
          incomeYear: year,
          kind: d.carType,
          usedFrom: d.usedFrom,
          usedTo: d.usedTo,
          costCents: d.costCents,
          parfRebateCents: d.parfRebateCents,
          coeYears: d.coeYears,
          rentalCents: d.rentalCents,
          runningCostsCents: d.runningCostsCents,
        }),
      );
      return {
        appendix: "8A",
        item: "4i",
        valueCents: c.valueCents,
        days: c.days,
        section: null,
        lines: [line("4i", "Car benefit", c.valueCents)],
        working: [...c.working],
        issues: [],
        car: c,
      };
    }
    case "other": {
      const meta = OTHER_BENEFIT_ITEMS[d.item];
      // Validated like every other item (field size), through the Appendix 8A total.
      rules(() => totalAppendix8a({ others: [{ item: meta.code, amountCents: d.amountCents }] }, year));
      return {
        appendix: "8A",
        item: meta.code,
        valueCents: d.amountCents,
        days: null,
        section: null,
        lines: [line(meta.code, meta.label, d.amountCents, true)],
        working: [],
        issues: [],
      };
    }
    case "share_gain": {
      const s = rules(() =>
        computeShareGain({
          incomeYear: year,
          planType: d.planType,
          grantedOn: d.grantedOn,
          eventDate: d.eventDate,
          exercisePrice: d.exercisePrice,
          openMarketValue: d.openMarketValue,
          shares: d.shares,
          today,
        }),
      );
      return {
        appendix: "8B",
        item: "8B",
        valueCents: s.grossGainCents,
        days: null,
        section: s.section,
        lines: [line("h", "Gross amount of gains", s.grossGainCents)],
        working: [...s.working],
        issues: [],
        share: s,
      };
    }
  }
}

export interface AppendixEntryRow {
  id: string;
  employeeId: string;
  details: AppendixEntryDetails;
  computed: EntryComputation;
}

export interface EmployeeAppendices {
  residences: AppendixEntryRow[];
  hotels: AppendixEntryRow[];
  cars: AppendixEntryRow[];
  others: AppendixEntryRow[];
  shareGains: AppendixEntryRow[];
  total8a: Appendix8aTotal;
  total8b: Appendix8bTotal;
}

const byStart = (a: AppendixEntryRow, b: AppendixEntryRow) => {
  const key = (r: AppendixEntryRow) =>
    r.details.kind === "residence"
      ? (r.details.occupiedFrom ?? "")
      : r.details.kind === "share_gain"
        ? r.details.eventDate
        : r.details.kind === "car"
          ? r.details.usedFrom
          : "";
  return key(a).localeCompare(key(b)) || a.id.localeCompare(b.id);
};

/** Groups one employee's entries and totals them (Appendix 8A total / IR8A d8; 8B totals / d7). */
export function employeeAppendices(rows: readonly AppendixEntryRow[], year: number): EmployeeAppendices {
  const of = (kind: AppendixEntryDetails["kind"]) => rows.filter((r) => r.details.kind === kind).sort(byStart);
  const residences = of("residence");
  const hotels = of("hotel");
  const cars = of("car");
  const others = of("other");
  const shareGains = of("share_gain");
  const total8a = rules(() =>
    totalAppendix8a(
      {
        residences: residences.flatMap((r) => (r.computed.residence ? [r.computed.residence] : [])),
        hotels: hotels.flatMap((r) => (r.computed.hotel ? [r.computed.hotel] : [])),
        cars: cars.flatMap((r) => (r.computed.car ? [r.computed.car] : [])),
        others: others.flatMap((r) =>
          r.details.kind === "other"
            ? [{ item: r.computed.item as Appendix8aEnteredItem, amountCents: r.details.amountCents }]
            : [],
        ),
      },
      year,
    ),
  );
  const total8b = totalAppendix8b(shareGains.flatMap((r) => (r.computed.share ? [r.computed.share] : [])));
  return { residences, hotels, cars, others, shareGains, total8a, total8b };
}

export const hasAppendix8a = (a: EmployeeAppendices) =>
  a.residences.length + a.hotels.length + a.cars.length + a.others.length > 0;
export const hasAppendix8b = (a: EmployeeAppendices) => a.shareGains.length > 0;

// ---------------------------------------------------------------------------------------------
// Template rows
// ---------------------------------------------------------------------------------------------

/** Row 1 of sheet `Appendix 8A(Accommodation)`, columns A–T, verbatim (IRAS's spelling and spaces). */
export const APPENDIX_8A_ACCOMMODATION_HEADERS = [
  /* A */ "*ID Type [Choose option]",
  /* B */ "*ID No.",
  /* C */ "Accommodation ID",
  /* D */ "1. Address Details",
  /* E */ "Occupation From (YYYY-MM-DD)",
  /* F */ "Occupation to (YYYY-MM-DD)",
  /* G */ "No.of Days",
  /* H */ "No.of employees sharing the premises(excluding family members who are not employees) Max up to 999",
  /* I */ "2a. Annual Value of Premises for the Period Provided",
  /* J */ "2b. Value of Furniture &Fittings",
  /* K */ "Value of Furniture &Fittings (2a* 2b)",
  /* L */ "2c. Rent Paid to Landlord including Rental of Furiniture & Fittings(apportioned amount, if applicable)",
  /* M */ "2d. Taxable Value of Residence (a + b) or (c) ",
  /* N */ "2e. Total Rent Paid by Employee for Place of Residence",
  /* O */ "2f. Total Taxable Value of Place of Residence (2d - 2e)",
  /* P */ "2g. Utilities/ Telephone/ Pager/ Suitcase/ Golf Bag & Accessories/ Camera/ Electronic Gadgets(e.g. Tablet, Laptop)",
  /* Q */ "2h. Driver",
  /* R */ "2i. Servant",
  /* S */ "2j. Taxable Value of Utilities and Housekeeping Costs (2g + 2h + 2i)",
  /* T */ "Overwrite computed value in 2a & 2b",
] as const;

/** Row 1 of sheet `Appendix 8A(Hotel & Others)`, columns A–Q, verbatim. */
export const APPENDIX_8A_HOTEL_OTHERS_HEADERS = [
  /* A */ "*ID Type [Choose option]",
  /* B */ "*ID No.",
  /* C */ "Hotel Accommodation",
  /* D */ "3a. Actual Cost of Hotel Accommodation/ Serviced Apartment within Hotel Building",
  /* E */ "3b. Amount Paid by Employee",
  /* F */ "3c. Taxable Value of Hotel Accommodation (3a - 3b)",
  /* G */ "4a. Cost of Home Leave Passages and Incidental Benefits Provided to Employee and his/ her Family",
  /* H */ "4b. Interest payment made by the employer to a third party on behalf of an employee and/or interest benefits arising from loans  provided by employer interest free or at a rate below market rate to the employee who has substantial shareholding or control ",
  /* I */ "4c. insurance Premiums Paid by the Employer",
  /* J */ "4d. Free or Subsidised Holidays including Air Passages etc",
  /* K */ "4e.Educational Expenses including Tutor Provided",
  /* L */ "4f. Entrance/ Transfer Fees and Annual Subscription to Social or Recreational Clubs",
  /* M */ "4g. Gains from Assets",
  /* N */ "4h. Full Cost of Motor Vehicles Given to Employee",
  /* O */ "4i. Car Benefits",
  /* P */ "4j. Other non - monetary awards/ benefits which do not fall within the previous items",
  /* Q */ "Total Value of Benefits in kind(items 2 to 4)",
] as const;

/** Row 1 of sheet `Appendix 8B`, columns A–M, verbatim (column M has line breaks in IRAS's header). */
export const APPENDIX_8B_HEADERS = [
  /* A */ "*ID Type [Choose option]",
  /* B */ "*ID No.",
  /* C */ "*Record ID",
  /* D */ "Organisation Tax Ref.No Type",
  /* E */ "a. Organization Tax Ref.No",
  /* F */ "b. Organization Name",
  /* G */ "c1. Type of Plan Granted",
  /* H */ "c2. Date Of grant (YYYY-MM-DD)",
  /* I */ "d. Date of exercise of ESOP or date of vesting of ESOW Plan (if applicable). If moratorium (i.e. selling restriction) is imposed, state the date the moratorium is lifted for the ESOP/ESOW Plans (YYYY-MM-DD)",
  /* J */ "e. Exercise Price of ESOP or Price Paid/Payable per Share under ESOW Plan",
  /* K */ "f. Open Market Value Per Share as at the Date Reflected at item (d) of this form",
  /* L */ "g.Number of Shares Acquired",
  /* M */ "h. Gross Amount\nof gains from ESOP/ESOW Plans\n(h) =  (f-e) x g",
] as const;

export type AppendixSheet = "appendix-8a-accommodation" | "appendix-8a-hotel-others" | "appendix-8b";

export const APPENDIX_SHEET_NAMES: Record<AppendixSheet, string> = {
  "appendix-8a-accommodation": "Appendix 8A(Accommodation)",
  "appendix-8a-hotel-others": "Appendix 8A(Hotel & Others)",
  "appendix-8b": "Appendix 8B",
};

/** The employee's key in every sheet: ID type and full ID number, as in the IR8A sheet. */
export interface AppendixPerson {
  idType: "NRIC" | "FIN";
  idNumber: string;
}

/** 8A amounts: two decimals (template "Max 7 Digits and 2 decimals"), empty when zero. */
const amount = (cents: number | null | undefined) => (cents ? centsToDecimal(cents) : "");

/**
 * `Appendix 8A(Accommodation)` rows: one per place of residence (Accommodation ID 1–10), in date
 * order. Locked, myTax-computed columns (G, I–K, M, O, S, T) stay empty. The AV method is disabled in
 * the template ("currently disabled. (2a and 2b)"), so owned premises carry no 2a/2b here.
 */
export function accommodationRows(p: AppendixPerson, a: EmployeeAppendices): string[][] {
  return a.residences.map((r, i) => {
    const d = r.details;
    if (d.kind !== "residence") throw new Error("residence expected");
    const row: string[] = new Array(APPENDIX_8A_ACCOMMODATION_HEADERS.length).fill("");
    row[0] = p.idType;
    row[1] = p.idNumber;
    row[2] = String(i + 1);
    if (d.basis !== "none") {
      row[3] = d.address ?? "";
      row[4] = d.occupiedFrom ?? "";
      row[5] = d.occupiedTo ?? "";
      row[7] = String(d.employeesSharing);
      if (d.basis === "rented") row[11] = amount(r.computed.residence?.rentPaidByEmployerCents);
      row[13] = amount(d.rentPaidByEmployeeCents);
    }
    row[15] = amount(d.utilitiesCents);
    row[16] = amount(r.computed.residence?.driverCents);
    row[17] = amount(d.servantCents);
    return row;
  });
}

/** `Appendix 8A(Hotel & Others)`: one row per employee with item 3 or 4; locked C, F and Q stay empty. */
export function hotelOthersRow(p: AppendixPerson, a: EmployeeAppendices): string[] | null {
  if (a.hotels.length + a.cars.length + a.others.length === 0) return null;
  const t = a.total8a;
  const row: string[] = new Array(APPENDIX_8A_HOTEL_OTHERS_HEADERS.length).fill("");
  row[0] = p.idType;
  row[1] = p.idNumber;
  if (a.hotels.length) {
    row[3] = centsToDecimal(t.hotel.costCents);
    row[4] = amount(t.hotel.paidByEmployeeCents);
  }
  const items = ["4a", "4b", "4c", "4d", "4e", "4f", "4g", "4h", "4i", "4j"] as const;
  items.forEach((code, i) => {
    row[6 + i] = amount(t.items[code]);
  });
  return row;
}

/** `Appendix 8B` rows: one per plan (Record ID 1–30); the locked gross amount (M) stays empty. */
export function shareGainRows(p: AppendixPerson, a: EmployeeAppendices): string[][] {
  return a.shareGains.map((r, i) => {
    const d = r.details;
    if (d.kind !== "share_gain") throw new Error("share gain expected");
    const row: string[] = new Array(APPENDIX_8B_HEADERS.length).fill("");
    row[0] = p.idType;
    row[1] = p.idNumber;
    row[2] = String(i + 1);
    row[3] = d.companyIdType ?? "";
    row[4] = d.companyIdNumber ?? "";
    row[5] = d.companyName ?? "";
    row[6] = d.planType;
    row[7] = d.grantedOn;
    row[8] = d.eventDate;
    row[9] = normaliseDecimal(d.exercisePrice);
    row[10] = normaliseDecimal(d.openMarketValue);
    row[11] = normaliseDecimal(d.shares);
    return row;
  });
}

/** "007.50000" → "7.5". */
export function normaliseDecimal(text: string): string {
  const [whole = "0", frac = ""] = text.trim().split(".");
  const w = whole.replace(/^0+(?=\d)/, "");
  const f = frac.replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

/** A sheet's CSV: header row, then the rows; UTF-8 BOM and CRLF like the IR8A rows. */
export function appendixCsv(headers: readonly string[], rows: readonly string[][]): string {
  const lines = [headers.map(ir8aCsvCell).join(","), ...rows.map((r) => r.map(ir8aCsvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
