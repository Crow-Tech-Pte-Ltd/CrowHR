import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson } from "./canonical.ts";

describe("canonical JSON", () => {
  it("does not depend on key order and drops undefined", async () => {
    const a = { b: 1, a: { d: [3, { y: 1, x: 2 }], c: "z" }, u: undefined };
    const b = { a: { c: "z", d: [3, { x: 2, y: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe('{"a":{"c":"z","d":[3,{"x":2,"y":1}]},"b":1}');
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(await canonicalHash(a)).toBe(await canonicalHash(b));
    expect(await canonicalHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps array order and rejects non-finite numbers", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(() => canonicalJson({ x: Number.NaN })).toThrow("non-finite");
  });
});
