import { describe, expect, it } from "vitest";
import { maskIdNumber, nricCheckLetter, validateIdNumber } from "./nric.ts";

describe("NRIC/FIN check letter", () => {
  // Vectors computed by hand from the public algorithm and cross-checked
  // against singapore-nric's implementation.
  it.each([
    ["S", "1234567", "D"],
    ["T", "1234567", "J"],
    ["F", "1234567", "N"],
    ["G", "1234567", "X"],
    ["M", "1234567", "K"],
    ["S", "0000000", "J"],
    ["T", "0000000", "G"],
    ["F", "0000000", "X"],
    ["G", "0000000", "R"],
    ["M", "0000000", "T"],
    ["S", "9876543", "C"],
  ] as const)("%s%s → %s", (prefix, digits, letter) => {
    expect(nricCheckLetter(prefix, digits)).toBe(letter);
  });

  it("accepts valid values for their type and normalises", () => {
    expect(validateIdNumber("nric", " s1234567d ")).toEqual({ ok: true, value: "S1234567D" });
    expect(validateIdNumber("nric", "T1234567J").ok).toBe(true);
    expect(validateIdNumber("fin", "F1234567N").ok).toBe(true);
    expect(validateIdNumber("fin", "G1234567X").ok).toBe(true);
    expect(validateIdNumber("fin", "M1234567K").ok).toBe(true);
  });

  it("rejects a wrong check letter with the spec message", () => {
    expect(validateIdNumber("nric", "S1234567A")).toEqual({
      ok: false,
      message: "This NRIC's check letter does not match. Check the last letter against the card.",
    });
    const fin = validateIdNumber("fin", "M1234567X");
    expect(fin.ok).toBe(false);
    if (!fin.ok) expect(fin.message).toContain("FIN's check letter");
  });

  it("rejects a prefix that does not match the ID type", () => {
    expect(validateIdNumber("nric", "G1234567X").ok).toBe(false);
    expect(validateIdNumber("fin", "S1234567D").ok).toBe(false);
    expect(validateIdNumber("nric", "S123456D").ok).toBe(false);
  });

  it("accepts passport-style values for other", () => {
    expect(validateIdNumber("other", "E1234567A").ok).toBe(true);
    expect(validateIdNumber("other", "x").ok).toBe(false);
  });

  it("masks as first char, four asterisks, last 3 digits and the letter", () => {
    expect(maskIdNumber("S1234567D")).toBe("S****567D");
    expect(maskIdNumber("M1234567K")).toBe("M****567K");
  });
});
