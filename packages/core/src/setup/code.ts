/**
 * One-time setup code (self-hosting spec "First-run setup wizard"): 16 characters from an
 * alphabet without look-alikes (no 0/O, 1/I/L, 2/Z, 5/S, 8/B), shown as XXXX-XXXX-XXXX-XXXX.
 * Only the SHA-256 hash is stored. Runtime-agnostic (Web Crypto).
 */
export const SETUP_CODE_ALPHABET = "34679ACDEFGHJKMNPQRTUVWXY";
export const SETUP_CODE_LENGTH = 16;

type RandomBytes = (length: number) => Uint8Array;
const webCryptoRandom: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Uniform over the alphabet (rejection sampling, no modulo bias). */
export function generateSetupCode(random: RandomBytes = webCryptoRandom): string {
  const n = SETUP_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < SETUP_CODE_LENGTH) {
    for (const b of random(32)) {
      if (b < limit && out.length < SETUP_CODE_LENGTH) out += SETUP_CODE_ALPHABET[b % n];
    }
  }
  return formatSetupCode(out);
}

export function formatSetupCode(raw: string): string {
  return (raw.match(/.{1,4}/g) ?? []).join("-");
}

/** Accepts lower case, spaces and missing dashes. */
export function normaliseSetupCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export async function hashSetupCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(`crowhr-setup:${normaliseSetupCode(code)}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings of equal length. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
