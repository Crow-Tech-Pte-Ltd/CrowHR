import { toBase64Url, utf8 } from "../../crypto/encoding.ts";

/**
 * Relying-party keys for Singpass (private_key_jwt signing, ES256; ID-token decryption,
 * ECDH-ES+A256KW on P-256), generated with Web Crypto. The private JWKS is stored encrypted;
 * the public JWKS is served at /api/v1/auth/oidc/<providerId>/jwks.json.
 */
export interface RpKeySet {
  privateJwks: { keys: JsonWebKey[] };
  publicJwks: { keys: JsonWebKey[] };
}

const subtle = () => globalThis.crypto.subtle;

/** RFC 7638 JWK thumbprint (EC keys), used as `kid`. */
export async function ecThumbprint(jwk: JsonWebKey): Promise<string> {
  const json = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return toBase64Url(new Uint8Array(await subtle().digest("SHA-256", utf8.encode(json))));
}

const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k", "oth"] as const;

export function publicOnly(jwk: JsonWebKey): JsonWebKey {
  const out: Record<string, unknown> = { ...jwk };
  for (const m of PRIVATE_MEMBERS) delete out[m];
  delete out.key_ops;
  delete out.ext;
  return out as JsonWebKey;
}

export async function generateRpKeys(): Promise<RpKeySet> {
  const sig = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const enc = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits", "deriveKey"]);
  const sigJwk = await subtle().exportKey("jwk", sig.privateKey);
  const encJwk = await subtle().exportKey("jwk", enc.privateKey);
  const sigPriv = { ...sigJwk, kid: await ecThumbprint(sigJwk), use: "sig", alg: "ES256" } as JsonWebKey;
  const encPriv = { ...encJwk, kid: await ecThumbprint(encJwk), use: "enc", alg: "ECDH-ES+A256KW" } as JsonWebKey;
  return {
    privateJwks: { keys: [sigPriv, encPriv] },
    publicJwks: { keys: [publicOnly(sigPriv), publicOnly(encPriv)] },
  };
}

export async function importSigningKey(jwks: { keys: JsonWebKey[] }): Promise<{ key: CryptoKey; kid: string }> {
  const jwk = jwks.keys.find((k) => (k as Record<string, unknown>).use === "sig") ?? jwks.keys[0];
  if (!jwk) throw new Error("No signing key in the relying-party JWKS.");
  const { kid, use: _use, alg: _alg, key_ops: _ops, ...rest } = jwk as JsonWebKey & { kid: string; use?: string };
  const key = await subtle().importKey("jwk", rest, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { key, kid };
}

export async function importDecryptionKey(jwks: {
  keys: JsonWebKey[];
}): Promise<{ key: CryptoKey; kid: string; alg: string } | null> {
  const jwk = jwks.keys.find((k) => (k as Record<string, unknown>).use === "enc");
  if (!jwk) return null;
  const { kid, use: _use, alg, key_ops: _ops, ...rest } = jwk as JsonWebKey & { kid: string; alg: string };
  const key = await subtle().importKey("jwk", rest, { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
    "deriveKey",
  ]);
  return { key, kid, alg: alg ?? "ECDH-ES+A256KW" };
}
