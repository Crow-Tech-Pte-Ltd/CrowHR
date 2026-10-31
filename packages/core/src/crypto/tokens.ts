import { toBase64Url, toHex, utf8 } from "./encoding.ts";

/** Cryptographically random bytes from Web Crypto. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** A 256-bit random token, base64url (43 characters). Used for sessions, invitations, resets, native codes. */
export function newToken(): string {
  return toBase64Url(randomBytes(32));
}

/** sha256 as lower-case hex. Tokens are stored only as this hash. */
export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const data = typeof value === "string" ? utf8.encode(value) : new Uint8Array(value);
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data)));
}

/** sha256 as base64url (PKCE S256 challenge, RFC 7636 §4.2). */
export async function sha256Base64Url(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", utf8.encode(value))));
}
