/**
 * Banks that Singapore employers commonly pay salaries into, with their
 * SWIFT/BIC codes (used to identify the bank in GIRO/FAST bank files).
 * Maintained list; extend as needed. Codes are each bank's published SWIFT BIC.
 */
export const SG_BANKS = [
  { code: "DBSSSGSG", name: "DBS Bank" },
  { code: "POSBSGSG", name: "POSB" },
  { code: "OCBCSGSG", name: "OCBC Bank" },
  { code: "UOVBSGSG", name: "UOB" },
  { code: "SCBLSGSG", name: "Standard Chartered Bank" },
  { code: "HSBCSGS2", name: "HSBC Singapore" },
  { code: "CITISGSL", name: "Citibank Singapore" },
  { code: "MBBESGS2", name: "Maybank Singapore" },
  { code: "BKCHSGSG", name: "Bank of China" },
  { code: "ICBKSGSG", name: "ICBC Singapore" },
  { code: "RHBBSGSG", name: "RHB Bank" },
  { code: "CIBBSGSG", name: "CIMB Bank" },
  { code: "HLBBSGSG", name: "HL Bank" },
  { code: "SIVBSGSG", name: "Sing Investments & Finance" },
  { code: "TRWISGSG", name: "Trust Bank" },
  { code: "GXSPSGSG", name: "GXS Bank" },
] as const;

export type SgBankCode = (typeof SG_BANKS)[number]["code"];

export function bankName(code: string): string {
  return SG_BANKS.find((b) => b.code === code)?.name ?? code;
}

/** Digits only, 6–17 long, after removing spaces and dashes. */
export function normaliseAccountNumber(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6,17}$/.test(digits) ? digits : null;
}
