import { describe, expect, it } from "vitest";
import { utf8 } from "../crypto/encoding.ts";
import { fromBase32, toBase32 } from "./base32.ts";
import { hotp, newTotpSecret, otpauthUri, totpAt, totpStep, verifyTotp } from "./totp.ts";

// RFC 6238 Appendix B: SHA-1 seed "12345678901234567890", 8 digits.
const seed = utf8.encode("12345678901234567890");
const VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP", () => {
  it.each(VECTORS)("matches RFC 6238 Appendix B at T=%i", async (t, expected) => {
    expect(await hotp(seed, Math.floor(t / 30), 8)).toBe(expected);
  });

  it("round-trips base32", () => {
    expect(fromBase32(toBase32(seed))).toEqual(seed);
    expect(toBase32(seed)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  const secret = newTotpSecret();
  const at = new Date("2026-10-31T01:00:00Z");

  it("accepts the current, previous and next step only", async () => {
    const step = totpStep(at);
    for (const offset of [-1, 0, 1]) {
      const code = await totpAt(secret, new Date(at.getTime() + offset * 30_000));
      expect(await verifyTotp(secret, code, at, null)).toBe(step + offset);
    }
    const old = await totpAt(secret, new Date(at.getTime() - 60_000));
    expect(await verifyTotp(secret, old, at, null)).toBeNull();
  });

  it("rejects a replayed code (step at or before the last used one)", async () => {
    const code = await totpAt(secret, at);
    const step = await verifyTotp(secret, code, at, null);
    expect(step).not.toBeNull();
    expect(await verifyTotp(secret, code, at, step)).toBeNull();
  });

  it("rejects malformed codes", async () => {
    expect(await verifyTotp(secret, "12345", at, null)).toBeNull();
    expect(await verifyTotp(secret, "abcdef", at, null)).toBeNull();
  });

  it("builds an otpauth URI", () => {
    expect(otpauthUri("ABC", "aisyah@example.sg", "Crow HR (Kampong Kopi)")).toBe(
      "otpauth://totp/Crow%20HR%20(Kampong%20Kopi)%3Aaisyah%40example.sg?secret=ABC&issuer=Crow%20HR%20(Kampong%20Kopi)&algorithm=SHA1&digits=6&period=30",
    );
  });
});
