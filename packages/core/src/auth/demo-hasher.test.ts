import { describe, expect, it } from "vitest";
import { createDemoPasswordHasher } from "./demo-hasher.ts";

describe("demo password hasher", () => {
  const hasher = createDemoPasswordHasher();
  it("round-trips with the $demo-pbkdf2$ prefix and a salt", async () => {
    const h = await hasher.hash("demo owner passphrase");
    expect(h).toMatch(/^\$demo-pbkdf2\$10000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await hasher.verify(h, "demo owner passphrase")).toBe(true);
    expect(await hasher.verify(h, "wrong")).toBe(false);
    expect(await hasher.hash("x")).not.toBe(await hasher.hash("x"));
  });
  it("never verifies foreign formats", async () => {
    expect(await hasher.verify("$argon2id$v=19$m=19456,t=2,p=1$abc$def", "x")).toBe(false);
    expect(await hasher.verify("$demo-pbkdf2$1$a$b", "x")).toBe(false);
  });
});
