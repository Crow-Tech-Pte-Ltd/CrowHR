import { describe, expect, it } from "vitest";
import { CSN_PAYMENT_TYPES } from "./statutory.ts";
import { isValidUen, UEN_FORMAT_MESSAGE, validateCsn } from "./uen.ts";

describe("UEN formats", () => {
  it.each([
    ["53312345D", "business (8 digits + letter)"],
    ["201912345K", "local company (year + 5 digits + letter)"],
    ["T09LL0001B", "other entity (T, year, type, 4 digits, letter)"],
    ["S99SS0123A", "other entity, 20th century"],
    [" 201912345k ", "normalised (spaces, lower case)"],
  ])("accepts %s (%s)", (uen) => {
    expect(isValidUen(uen)).toBe(true);
  });

  it.each(["12345", "1234567D", "123456789", "301912345K", "X09LL0001B", "T09LL001B", "T09LL00012"])(
    "rejects %s",
    (uen) => {
      expect(isValidUen(uen)).toBe(false);
    },
  );

  it("lists the three formats with an example of each", () => {
    for (const example of ["53312345D", "201912345K", "T09LL0001B"]) expect(UEN_FORMAT_MESSAGE).toContain(example);
  });
});

describe("CSN", () => {
  it("must begin with the organisation's UEN", () => {
    const r = validateCsn("201812345KPTE01", "201912345K");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("must begin with the organisation's UEN");
  });

  it("accepts UEN + cited payment type + 2-digit serial", () => {
    expect(validateCsn("201912345kpte01", "201912345K")).toEqual({ ok: true, value: "201912345KPTE01" });
    expect(validateCsn("53312345DAMS02", "53312345D").ok).toBe(true);
  });

  it("rejects unknown payment types and bad serials", () => {
    const r = validateCsn("201912345KXYZ01", "201912345K");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("PTE");
    expect(validateCsn("201912345KPTE1", "201912345K").ok).toBe(false);
  });

  it("uses the payment-type list cited from CPF", () => {
    expect(CSN_PAYMENT_TYPES).toEqual(["PTE", "AMS", "VCT", "MSE"]);
  });
});
