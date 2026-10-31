import { randomBytes } from "../crypto/tokens.ts";
import { fromBase32, toBase32 } from "./base32.ts";

/**
 * TOTP (RFC 6238) on Web Crypto: HMAC-SHA-1, 6 digits, 30-second step. Verification accepts
 * ±1 step and refuses any step at or before `lastStep`, so each code works once.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function newTotpSecret(): string {
  return toBase32(randomBytes(20));
}

export async function hotp(
  secret: Uint8Array,
  counter: number,
  digits = TOTP_DIGITS,
  hash: "SHA-1" | "SHA-256" | "SHA-512" = "SHA-1",
): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await globalThis.crypto.subtle.importKey("raw", new Uint8Array(secret), { name: "HMAC", hash }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, msg));
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const bin =
    (((mac[offset] as number) & 0x7f) << 24) |
    ((mac[offset + 1] as number) << 16) |
    ((mac[offset + 2] as number) << 8) |
    (mac[offset + 3] as number);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function totpAt(secretBase32: string, at: Date): Promise<string> {
  return hotp(fromBase32(secretBase32), totpStep(at));
}

/** Returns the matched step, or null. */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  at: Date,
  lastStep: number | null,
): Promise<number | null> {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = fromBase32(secretBase32);
  const now = totpStep(at);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if ((await hotp(secret, step)) === clean) return step;
  }
  return null;
}

/** otpauth:// URI for authenticator apps (Key Uri Format). */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
