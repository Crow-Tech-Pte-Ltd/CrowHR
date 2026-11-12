import { describe, expect, it } from "vitest";
import { compareClaimNumbers } from "./claim-number.ts";

describe("compareClaimNumbers (mirrors the server's length-then-text order)", () => {
  it("sorts C-9999 before C-10000, drafts (no number) last", () => {
    const sorted = ["C-10000", null, "C-0002", "C-9999", "C-10001", "C-0010"].sort(compareClaimNumbers);
    expect(sorted).toEqual(["C-0002", "C-0010", "C-9999", "C-10000", "C-10001", null]);
  });

  it("treats an empty string like no number", () => {
    expect(compareClaimNumbers("", "C-0001")).toBeGreaterThan(0);
    expect(compareClaimNumbers("C-0001", "")).toBeLessThan(0);
    expect(compareClaimNumbers("", null)).toBe(0);
    expect(compareClaimNumbers("C-0001", "C-0001")).toBe(0);
  });
});
