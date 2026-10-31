import { describe, expect, it } from "vitest";
import { createArgon2Hasher } from "./argon2-hasher.ts";

describe("argon2id hasher", () => {
  // Low memory cost keeps the test fast; production uses the OWASP defaults.
  const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1 });

  it("produces an argon2id PHC string that verifies", async () => {
    const phc = await hasher.hash("correct horse battery staple");
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/);
    expect(await hasher.verify(phc, "correct horse battery staple")).toBe(true);
    expect(await hasher.verify(phc, "wrong")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hasher.hash("same")).not.toBe(await hasher.hash("same"));
  });

  it("returns false for a malformed hash instead of throwing", async () => {
    expect(await hasher.verify("not-a-hash", "x")).toBe(false);
  });
});
