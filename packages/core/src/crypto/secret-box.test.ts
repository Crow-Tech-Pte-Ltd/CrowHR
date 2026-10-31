import { describe, expect, it } from "vitest";
import {
  createSecretBox,
  generateSecretKey,
  normaliseBankAccount,
  normaliseNric,
  parseSecretKey,
  SecretBoxError,
} from "./secret-box.ts";

const key = parseSecretKey("x".repeat(43).replace(/x/g, "A"));
const otherKey = parseSecretKey(generateSecretKey());

describe("SecretBox", () => {
  it("round-trips and prefixes the version and key id", async () => {
    const box = createSecretBox(key);
    const ct = await box.encrypt("nric", "S1234567D");
    expect(ct).toMatch(new RegExp(`^v1\\.${await box.keyId()}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]+$`));
    expect(ct).not.toContain("S1234567D");
    expect(await box.decrypt("nric", ct)).toBe("S1234567D");
    // Fresh IV every time.
    expect(await box.encrypt("nric", "S1234567D")).not.toBe(ct);
  });

  it("rejects tampering, the wrong purpose and a foreign key", async () => {
    const box = createSecretBox(key);
    const ct = await box.encrypt("nric", "S1234567D");
    const parts = ct.split(".");
    const body = parts[3] as string;
    const flipped = (body[2] === "A" ? "B" : "A") as string;
    const tampered = [...parts.slice(0, 3), body.slice(0, 2) + flipped + body.slice(3)].join(".");
    await expect(box.decrypt("nric", tampered)).rejects.toBeInstanceOf(SecretBoxError);
    await expect(box.decrypt("bank-account", ct)).rejects.toBeInstanceOf(SecretBoxError);
    const other = createSecretBox(otherKey);
    await expect(other.decrypt("nric", ct)).rejects.toThrow("different key");
    await expect(box.decrypt("nric", "plaintext")).rejects.toThrow("format");
  });

  it("produces a stable, case-normalised blind index for NRIC", async () => {
    const box = createSecretBox(key);
    const a = await box.blindIndex("nric", normaliseNric(" s1234567d "));
    const b = await box.blindIndex("nric", normaliseNric("S1234567D"));
    expect(a).toBe(b);
    expect(a).not.toBe(await box.blindIndex("bank-account", normaliseNric("S1234567D")));
    expect(a).not.toBe(await createSecretBox(otherKey).blindIndex("nric", "S1234567D"));
    expect(normaliseBankAccount("123-456 789")).toBe("123456789");
  });

  it("has a key-specific check value", async () => {
    const box = createSecretBox(key);
    expect(await box.checkValue()).toBe(await createSecretBox(key).checkValue());
    expect(await box.checkValue()).not.toBe(await createSecretBox(otherKey).checkValue());
  });

  it("parses base64, base64url and hex keys and refuses the wrong length", () => {
    expect(parseSecretKey("ab".repeat(32))).toHaveLength(32);
    expect(parseSecretKey(`${"A".repeat(43)}=`)).toHaveLength(32);
    expect(() => parseSecretKey("too-short")).toThrow("exactly 32 bytes");
  });
});
