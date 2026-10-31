/**
 * Contact-detail normalisation. Phone numbers are stored as E.164; an
 * 8-digit number (Singapore numbering plan) is taken as +65.
 */
export type PhoneResult = { ok: true; value: string } | { ok: false; message: string };

export function normalisePhone(raw: string): PhoneResult {
  const compact = raw.replace(/[\s()-]/g, "");
  if (/^\d{8}$/.test(compact)) return { ok: true, value: `+65${compact}` };
  if (/^65\d{8}$/.test(compact)) return { ok: true, value: `+${compact}` };
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return { ok: true, value: compact };
  return {
    ok: false,
    message: "Enter an 8-digit Singapore number like 9123 4567, or an international number starting with +.",
  };
}

export const MAX_EMERGENCY_CONTACTS = 3;

export function isSgPostalCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
