import { describe, expect, it } from "vitest";
import { toCsv as peopleCsv } from "../employees/import/parse.ts";
import { bankAccountInput, personInput } from "../employees/schemas.ts";
import { toCsv as leaveCsv } from "../leave/outputs.ts";
import { companyProfileInput } from "../organisation/profile.ts";
import { formatCsvCell } from "./csv.ts";

describe("CSV and name safety", () => {
  it.each([peopleCsv, leaveCsv])("every writer quotes embedded CR and neutralises formula prefixes", (write) => {
    for (const value of ["A\rB", "A\nB", "A,B", 'A"B', "=1+2", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
      expect(write(["name"], [[value]])).toBe(`name\r\n${formatCsvCell(value, "text")}\r\n`);
    }
  });
  it.each(["\r", "\n", "\t", "\u0000", "\u007f"])(
    "rejects control characters in legal and bank names: %j",
    (control) => {
      expect(personInput.shape.legalName.safeParse(`A${control}B`).success).toBe(false);
      expect(
        bankAccountInput.safeParse({
          bankCode: "DBSSSGSG",
          accountNumber: "123456789",
          holderName: `${control}A`,
          effectiveFrom: "2026-10-01",
        }).success,
      ).toBe(false);
      expect(companyProfileInput.safeParse({ legalName: `A${control}B`, uen: "201912345K" }).success).toBe(false);
    },
  );
});
