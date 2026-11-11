import { describe, expect, it } from "vitest";
import { groupEmployeeNotes, namesSummary } from "./notes.ts";

describe("IR8A note grouping", () => {
  it("groups identical notes and keeps different ones apart, in first-seen order", () => {
    const missing = "No payslips or opening balance for January 2026 to July 2026: add that income in myTax.";
    const june = "No payslips or opening balance for June 2026 to July 2026: add that income in myTax.";
    const groups = groupEmployeeNotes([
      { employeeName: "Ahmad", notes: [{ code: "YTD", message: missing }] },
      { employeeName: "Arjun", notes: [{ code: "YTD", message: missing }] },
      { employeeName: "Ong", notes: [{ code: "YTD", message: june }] },
      { employeeName: "Zhang", notes: [{ code: "YTD", message: missing }] },
    ]);
    expect(groups.map((g) => [g.message, g.names])).toEqual([
      [missing, ["Ahmad", "Arjun", "Zhang"]],
      [june, ["Ong"]],
    ]);
  });

  it("summarises names", () => {
    expect(namesSummary(["Ahmad"])).toBe("Ahmad");
    expect(namesSummary(["Ahmad", "Arjun"])).toBe("Ahmad and Arjun");
    expect(namesSummary(["A", "B", "C"])).toBe("A, B and C");
    expect(namesSummary(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });
});
