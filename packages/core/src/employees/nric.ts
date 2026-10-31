/**
 * NRIC/FIN format and check-letter validation.
 *
 * Reimplemented from the public algorithm as implemented by `singapore-nric`
 * (https://github.com/samliew/singapore-nric, src/nric.ts; MIT, Copyright (c)
 * 2022 Samuel Liew), including the M-series FIN rotation. Weights 2,7,6,5,4,3,2;
 * offset 0 for S/F, 4 for T/G, 3 for M (index rotated as 10 - i).
 */

const WEIGHTS = [2, 7, 6, 5, 4, 3, 2] as const;
const TABLE_ST = "JZIHGFEDCBA";
const TABLE_FG = "XWUTRQPNMLK";
const TABLE_M = "KLJNPQRTUWX";

export type NricPrefix = "S" | "T" | "F" | "G" | "M";
const FORMAT = /^[STFGM]\d{7}[A-Z]$/;

/** Trims, removes inner spaces, uppercases. */
export function normaliseIdNumber(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function nricCheckLetter(prefix: NricPrefix, digits: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(digits[i]) * (WEIGHTS[i] as number);
  const offset = prefix === "T" || prefix === "G" ? 4 : prefix === "M" ? 3 : 0;
  let index = (sum + offset) % 11;
  if (prefix === "M") index = 10 - index;
  const table = prefix === "S" || prefix === "T" ? TABLE_ST : prefix === "M" ? TABLE_M : TABLE_FG;
  return table[index] as string;
}

export type IdValidation = { ok: true; value: string } | { ok: false; message: string };

/**
 * Validates an ID number for its declared type. `nric` must start with S or T;
 * `fin` with F, G or M; `other` (passport etc.) only needs 4–20 letters/digits.
 */
export function validateIdNumber(idType: "nric" | "fin" | "other", raw: string): IdValidation {
  const value = normaliseIdNumber(raw);
  if (idType === "other") {
    return /^[A-Z0-9-]{4,20}$/.test(value)
      ? { ok: true, value }
      : { ok: false, message: "Use 4 to 20 letters, digits or dashes, as printed on the document." };
  }
  const label = idType === "nric" ? "NRIC" : "FIN";
  const prefixes = idType === "nric" ? "ST" : "FGM";
  if (!FORMAT.test(value) || !prefixes.includes(value[0] as string)) {
    return {
      ok: false,
      message:
        idType === "nric"
          ? "An NRIC is S or T, 7 digits and a letter, like S1234567D."
          : "A FIN is F, G or M, 7 digits and a letter, like G1234567X.",
    };
  }
  const expected = nricCheckLetter(value[0] as NricPrefix, value.slice(1, 8));
  if (expected !== value[8]) {
    return {
      ok: false,
      message: `This ${label}'s check letter does not match. Check the last letter against the card.`,
    };
  }
  return { ok: true, value };
}

/** `S1234567D` → `S****567D`: first character, four asterisks, last 3 digits and the check letter. */
export function maskIdNumber(value: string): string {
  if (value.length < 5) return "****";
  return `${value[0]}****${value.slice(-4)}`;
}

/** Bank and pass numbers: last 4 visible. */
export function maskTail(value: string, visible = 4): string {
  return `••••${value.slice(-visible)}`;
}
