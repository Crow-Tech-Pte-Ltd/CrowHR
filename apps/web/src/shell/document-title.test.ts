import { describe, expect, it } from "vitest";
import { titleFor } from "./document-title.ts";

describe("titleFor", () => {
  it("puts the page heading before the product name", () => {
    expect(titleFor("Leave", "Crow HR")).toBe("Leave · Crow HR");
    expect(titleFor("  October 2026\n   payroll ", "Crow HR demo")).toBe("October 2026 payroll · Crow HR demo");
  });

  it("falls back to the product name while a page has no heading", () => {
    expect(titleFor(undefined, "Crow HR")).toBe("Crow HR");
    expect(titleFor("   ", "Crow HR")).toBe("Crow HR");
  });
});
