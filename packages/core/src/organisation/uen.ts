import { CSN_PAYMENT_TYPES } from "./statutory.ts";

/**
 * ACRA UEN structural formats (spec: organisation / Company profile):
 * - businesses registered with ACRA: 8 digits + letter, e.g. `53312345D`;
 * - local companies: 4-digit year + 5 digits + letter, e.g. `201912345K`;
 * - other entities: `T` or `S` (century), 2-digit year, 2-character entity type, 4 digits, letter, e.g. `T09LL0001B`.
 * Only the structure is checked; ACRA's check-letter algorithm is not public.
 */
const UEN_FORMATS = [/^\d{8}[A-Z]$/, /^(19|20)\d{2}\d{5}[A-Z]$/, /^[ST]\d{2}[A-Z0-9]{2}\d{4}[A-Z]$/];

export const UEN_FORMAT_MESSAGE =
  "Enter a UEN in one of the three ACRA formats: 8 digits and a letter (e.g. 53312345D), " +
  "a 4-digit year, 5 digits and a letter (e.g. 201912345K), or T/S, 2 digits, a 2-character entity type, " +
  "4 digits and a letter (e.g. T09LL0001B).";

export function normaliseUen(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidUen(raw: string): boolean {
  const uen = normaliseUen(raw);
  return UEN_FORMATS.some((re) => re.test(uen));
}

export type CsnCheck = { ok: true; value: string } | { ok: false; message: string };

/** CSN = organisation UEN + 3-letter payment type + 2-digit serial, e.g. `201912345KPTE01`. */
export function validateCsn(rawCsn: string, rawUen: string): CsnCheck {
  const csn = normaliseUen(rawCsn);
  const uen = normaliseUen(rawUen);
  if (!csn.startsWith(uen)) {
    return {
      ok: false,
      message: `The CSN must begin with the organisation's UEN (${uen}), followed by the payment type and serial, e.g. ${uen}PTE01.`,
    };
  }
  const rest = csn.slice(uen.length);
  const m = /^([A-Z]{3})(\d{2})$/.exec(rest);
  if (!m) {
    return {
      ok: false,
      message: `After the UEN, the CSN needs a 3-letter payment type and a 2-digit serial, e.g. ${uen}PTE01.`,
    };
  }
  if (!(CSN_PAYMENT_TYPES as readonly string[]).includes(m[1] as string)) {
    return {
      ok: false,
      message: `"${m[1]}" is not a CPF payment type. Use one of ${CSN_PAYMENT_TYPES.join(", ")} (PTE for regular staff).`,
    };
  }
  return { ok: true, value: csn };
}
