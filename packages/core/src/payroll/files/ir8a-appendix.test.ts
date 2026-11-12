import { describe, expect, it } from "vitest";
import { AppError } from "../../errors.ts";
import {
  APPENDIX_8A_ACCOMMODATION_HEADERS,
  APPENDIX_8A_HOTEL_OTHERS_HEADERS,
  APPENDIX_8B_HEADERS,
  type AppendixEntryRow,
  accommodationRows,
  appendixCsv,
  computeEntry,
  employeeAppendices,
  hotelOthersRow,
  normaliseDecimal,
  shareGainRows,
} from "./ir8a-appendix.ts";
import { type AppendixEntryDetails, appendixEntryInput } from "./ir8a-appendix-input.ts";

const TODAY = "2026-10-31";
const person = { idType: "NRIC" as const, idNumber: "S1234567D" };
let seq = 0;
const row = (input: Record<string, unknown>, employeeId = "e1"): AppendixEntryRow => {
  const details: AppendixEntryDetails = appendixEntryInput.parse(input);
  return { id: `id-${++seq}`, employeeId, details, computed: computeEntry(details, 2026, TODAY) };
};

describe("IRAS template sheet headers", () => {
  it("have the template's column counts (A–T, A–Q, A–M) and its verbatim text", () => {
    expect(APPENDIX_8A_ACCOMMODATION_HEADERS).toHaveLength(20);
    expect(APPENDIX_8A_HOTEL_OTHERS_HEADERS).toHaveLength(17);
    expect(APPENDIX_8B_HEADERS).toHaveLength(13);
    expect(APPENDIX_8A_ACCOMMODATION_HEADERS[11]).toContain("Furiniture"); // IRAS's spelling
    expect(APPENDIX_8A_HOTEL_OTHERS_HEADERS[14]).toBe("4i. Car Benefits");
    expect(APPENDIX_8B_HEADERS[2]).toBe("*Record ID");
  });
});

describe("entries → appendix rows", () => {
  it("puts a household-only record (driver, no residence) on an accommodation row without address or dates", () => {
    const a = employeeAppendices(
      [
        row({
          kind: "residence",
          basis: "none",
          driverAnnualCostCents: 3_600_000,
          driverPersonalKm: 1_000,
          driverTotalKm: 4_000,
        }),
      ],
      2026,
    );
    const [r] = accommodationRows(person, a);
    expect(r?.slice(0, 8)).toEqual(["NRIC", "S1234567D", "1", "", "", "", "", ""]);
    expect(r?.[16]).toBe("9000.00");
    expect(hotelOthersRow(person, a)).toBeNull();
    expect(a.total8a.ir8aD8Dollars).toBe(9_000);
  });

  it("sums items of the same kind into one Hotel & Others row", () => {
    const a = employeeAppendices(
      [
        row({ kind: "other", item: "education", amountCents: 120_050 }),
        row({ kind: "other", item: "education", amountCents: 1 }),
        row({ kind: "other", item: "other", amountCents: 9_900, note: "Long-service watch" }),
        row({ kind: "hotel", costCents: 50_000, paidByEmployeeCents: 5_000 }),
      ],
      2026,
    );
    const r = hotelOthersRow(person, a) ?? [];
    expect([r[3], r[4], r[5], r[10], r[15], r[16]]).toEqual(["500.00", "50.00", "", "1200.51", "99.00", ""]);
    expect(a.total8a.totalCents).toBe(45_000 + 120_051 + 9_900);
  });

  it("numbers share records per employee and writes prices as plain decimals", () => {
    const a = employeeAppendices(
      [
        row({
          kind: "share_gain",
          planType: "ESOP",
          grantedOn: "2024-01-02",
          eventDate: "2026-09-01",
          exercisePrice: "0010.50000",
          openMarketValue: "12.75",
          shares: "1500.5",
        }),
        row({
          kind: "share_gain",
          planType: "ESOW",
          grantedOn: "2026-02-01",
          eventDate: "2026-02-01",
          exercisePrice: "0",
          openMarketValue: "4",
          shares: "100",
        }),
      ],
      2026,
    );
    const rows = shareGainRows(person, a);
    // Sorted by the date the gain accrues: the ESOW (Feb) first.
    expect(rows.map((r) => [r[2], r[6], r[9], r[10], r[11], r[12]])).toEqual([
      ["1", "ESOW", "0", "4", "100", ""],
      ["2", "ESOP", "10.5", "12.75", "1500.5", ""],
    ]);
    // (12.75 − 10.50) × 1,500.5 = $3,376.125 → $3,376.12; plus $400.
    expect(a.total8b).toEqual({ s101bCents: 377_612, s101gCents: 0, ir8aD7aDollars: 3_776, ir8aD7bDollars: 0 });
  });

  it("writes a UTF-8 BOM, CRLF lines and quotes IRAS's multi-line header", () => {
    const csv = appendixCsv(APPENDIX_8B_HEADERS, [["NRIC", "S1234567D"]]);
    expect(csv.startsWith("﻿*ID Type [Choose option],")).toBe(true);
    expect(csv).toContain('"h. Gross Amount\nof gains from ESOP/ESOW Plans\n(h) =  (f-e) x g"\r\nNRIC,S1234567D\r\n');
  });

  it("normalises decimals", () => {
    expect(["007.50000", "0", "10", "0.00001", "1.0"].map(normaliseDecimal)).toEqual([
      "7.5",
      "0",
      "10",
      "0.00001",
      "1",
    ]);
  });
});

describe("input validation", () => {
  it("turns sg-rules refusals into validation errors", () => {
    const d = appendixEntryInput.parse({ kind: "hotel", costCents: 1, paidByEmployeeCents: 2 });
    expect(() => computeEntry(d, 2026, TODAY)).toThrow(AppError);
    expect(() => computeEntry(d, 2026, TODAY)).toThrow(/more than the stay cost/);
  });

  it("needs all three granting-company fields or none", () => {
    const base = {
      kind: "share_gain",
      planType: "ESOP",
      grantedOn: "2024-01-02",
      eventDate: "2026-09-01",
      exercisePrice: "1",
      openMarketValue: "2",
      shares: "1",
    };
    expect(appendixEntryInput.safeParse({ ...base, companyName: "Parent Ltd" }).success).toBe(false);
    expect(
      appendixEntryInput.safeParse({
        ...base,
        companyIdType: "OTHERS",
        companyIdNumber: "X1",
        companyName: "Parent Ltd",
      }).success,
    ).toBe(true);
    expect(appendixEntryInput.safeParse({ ...base, shares: "1,000" }).success).toBe(false);
  });

  it("refuses amounts above IRAS's field size and fractional cents", () => {
    expect(appendixEntryInput.safeParse({ kind: "other", item: "club", amountCents: 1_000_000_000 }).success).toBe(
      false,
    );
    expect(appendixEntryInput.safeParse({ kind: "other", item: "club", amountCents: 1.5 }).success).toBe(false);
    expect(appendixEntryInput.safeParse({ kind: "other", item: "club", amountCents: 0 }).success).toBe(false);
  });
});
