import { secretKeyChecks } from "../db/schema/auth.ts";
import type { Db } from "../db/types.ts";
import { fromBase64Url, toBase64Url, toHex, utf8 } from "./encoding.ts";
import { randomBytes } from "./tokens.ts";

/**
 * Encryption at rest for sensitive identifiers and secrets (access-control spec "Encryption of
 * sensitive identifiers and secrets"). AES-256-GCM via Web Crypto; one key per purpose derived
 * with HKDF-SHA-256 from CROWHR_SECRET_KEY (`info = crowhr/v1/<purpose>`).
 *
 * Ciphertext: `v1.<keyId>.<iv>.<ct>` (base64url). `keyId` identifies the master key so rotation
 * can be added later. Blind indexes are HMAC-SHA-256 under a separate HKDF purpose, over a
 * value normalised by the caller (`normaliseNric`, `normaliseBankAccount`).
 */
export interface SecretBox {
  keyId(): Promise<string>;
  encrypt(purpose: string, plaintext: string): Promise<string>;
  /** Throws `SecretBoxError` for tampered, truncated or foreign-key ciphertexts. */
  decrypt(purpose: string, ciphertext: string): Promise<string>;
  blindIndex(purpose: string, normalisedValue: string): Promise<string>;
  /** A value stored at first boot; a different key produces a different value. */
  checkValue(): Promise<string>;
}

export class SecretBoxError extends Error {
  override name = "SecretBoxError";
}

/** Purposes in use. Adding one is free; renaming one makes old ciphertexts unreadable. */
export const SECRET_PURPOSES = {
  totp: "totp",
  ssoClientSecret: "sso-client-secret",
  ssoPrivateJwks: "sso-private-jwks",
  oidcTransaction: "oidc-transaction",
  nric: "nric",
  bankAccount: "bank-account",
  passport: "passport",
  workPass: "work-pass",
  /** Blind index of a visitor's network for the demo-company start limits (never the address). */
  demoNetwork: "demo-network",
} as const;

const subtle = () => globalThis.crypto.subtle;

async function hkdf(master: CryptoKey, info: string, usage: "aes" | "hmac"): Promise<CryptoKey> {
  const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8.encode(info) };
  return usage === "aes"
    ? subtle().deriveKey(params, master, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
    : subtle().deriveKey(params, master, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
}

/** Decodes CROWHR_SECRET_KEY: 32 bytes as base64url/base64 (43–44 chars) or hex (64 chars). */
export function parseSecretKey(value: string): Uint8Array<ArrayBuffer> {
  const v = value.trim();
  let bytes: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(v)) {
    bytes = new Uint8Array(v.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
  } else {
    try {
      bytes = fromBase64Url(v.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    } catch {
      throw new SecretBoxError("CROWHR_SECRET_KEY must be exactly 32 bytes, base64 or hex encoded.");
    }
  }
  if (bytes.length !== 32) {
    throw new SecretBoxError(`CROWHR_SECRET_KEY must decode to exactly 32 bytes (got ${bytes.length}).`);
  }
  return new Uint8Array(bytes);
}

/** A fresh random key, base64url — what first boot writes when none is supplied. */
export function generateSecretKey(): string {
  return toBase64Url(randomBytes(32));
}

/** Synchronous to construct (keys are derived lazily on first use), so hosts can build deps synchronously. */
export function createSecretBox(rawKey: Uint8Array): SecretBox {
  if (rawKey.length !== 32) throw new SecretBoxError("The secret key must be exactly 32 bytes.");
  const keyBytes = new Uint8Array(rawKey);
  const masterP = subtle().importKey("raw", keyBytes, "HKDF", false, ["deriveKey"]);
  const keyIdP = masterP.then(async (master) => {
    const idKey = await hkdf(master, "crowhr/v1/key-id", "hmac");
    return toHex(new Uint8Array(await subtle().sign("HMAC", idKey, utf8.encode("key-id")))).slice(0, 12);
  });
  const aesKeys = new Map<string, Promise<CryptoKey>>();
  const hmacKeys = new Map<string, Promise<CryptoKey>>();
  const derive = (cache: Map<string, Promise<CryptoKey>>, info: string, usage: "aes" | "hmac") => {
    let k = cache.get(info);
    if (!k) {
      k = masterP.then((master) => hkdf(master, info, usage));
      cache.set(info, k);
    }
    return k;
  };
  const aes = (purpose: string) => derive(aesKeys, `crowhr/v1/${purpose}`, "aes");
  const hmac = (purpose: string) => derive(hmacKeys, `crowhr/v1/blind-index/${purpose}`, "hmac");

  return {
    keyId: () => keyIdP,
    async encrypt(purpose, plaintext) {
      const keyId = await keyIdP;
      const iv = randomBytes(12);
      const ct = await subtle().encrypt(
        { name: "AES-GCM", iv, additionalData: utf8.encode(`${keyId}/${purpose}`) },
        await aes(purpose),
        utf8.encode(plaintext),
      );
      return `v1.${keyId}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
    },
    async decrypt(purpose, ciphertext) {
      const keyId = await keyIdP;
      const parts = ciphertext.split(".");
      if (parts.length !== 4 || parts[0] !== "v1") throw new SecretBoxError("Unrecognised ciphertext format.");
      if (parts[1] !== keyId) throw new SecretBoxError("Ciphertext was encrypted with a different key.");
      try {
        const pt = await subtle().decrypt(
          {
            name: "AES-GCM",
            iv: new Uint8Array(fromBase64Url(parts[2] as string)),
            additionalData: utf8.encode(`${keyId}/${purpose}`),
          },
          await aes(purpose),
          new Uint8Array(fromBase64Url(parts[3] as string)),
        );
        return utf8.decode(new Uint8Array(pt));
      } catch {
        throw new SecretBoxError("Ciphertext failed authentication (tampered or wrong purpose).");
      }
    },
    async blindIndex(purpose, normalisedValue) {
      const sig = await subtle().sign("HMAC", await hmac(purpose), utf8.encode(normalisedValue));
      return toBase64Url(new Uint8Array(sig));
    },
    async checkValue() {
      const sig = await subtle().sign("HMAC", await hmac("key-check"), utf8.encode("crowhr-key-check"));
      return toBase64Url(new Uint8Array(sig));
    },
  };
}

/** NRIC/FIN for blind indexing: upper-case, no whitespace. */
export function normaliseNric(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Bank account number for blind indexing: digits and letters only. */
export function normaliseBankAccount(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * Startup check (spec: refuse a key that does not match the check value stored in the
 * database). First boot stores the check value; later boots must reproduce it.
 */
export async function verifySecretKeyAgainstDb(
  db: Db,
  box: SecretBox,
): Promise<{ ok: true; firstBoot: boolean } | { ok: false; message: string }> {
  const rows = await db.select().from(secretKeyChecks);
  const keyId = await box.keyId();
  const check = await box.checkValue();
  if (rows.length === 0) {
    await db.insert(secretKeyChecks).values({ keyId, checkValue: check }).onConflictDoNothing();
    return { ok: true, firstBoot: true };
  }
  const match = rows.find((r) => r.keyId === keyId && r.checkValue === check);
  if (match) return { ok: true, firstBoot: false };
  return {
    ok: false,
    message:
      "CROWHR_SECRET_KEY does not match the key this database was set up with, so encrypted data (NRIC, bank numbers, MFA and SSO secrets) cannot be read. Restore the original key from your backup; do not generate a new one.",
  };
}
