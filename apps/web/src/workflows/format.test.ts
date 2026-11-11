import { describe, expect, it } from "vitest";
import { ageLabel, dueLabel, requestName, sgDate, thresholdLabel } from "./format.ts";

describe("workflow formatting", () => {
  it("labels due states", () => {
    expect(dueLabel(null, "2026-10-31")).toBeNull();
    expect(dueLabel("2026-10-29", "2026-10-31")).toEqual({ text: "Overdue 2 days", tone: "danger" });
    expect(dueLabel("2026-10-30", "2026-10-31")).toEqual({ text: "Overdue 1 day", tone: "danger" });
    expect(dueLabel("2026-10-31", "2026-10-31")?.text).toBe("Due today");
    expect(dueLabel("2026-11-01", "2026-10-31")?.text).toBe("Due tomorrow");
    expect(dueLabel("2026-12-03", "2026-10-31")?.text).toBe("Due 3 Dec 2026");
    expect(dueLabel("2026-12-03", "2026-10-31", { short: true })?.text).toBe("Due 3 Dec");
    expect(dueLabel("2027-01-03", "2026-10-31", { short: true })?.text).toBe("Due 3 Jan 2027");
  });

  it("labels ages in Singapore time", () => {
    expect(sgDate("2026-10-30T16:30:00.000Z")).toBe("2026-10-31");
    expect(ageLabel("2026-10-31T01:00:00.000Z", "2026-10-31")).toBe("today");
    expect(ageLabel("2026-10-30T01:00:00.000Z", "2026-10-31")).toBe("yesterday");
    expect(ageLabel("2026-10-27T01:00:00.000Z", "2026-10-31")).toBe("4 days ago");
    expect(ageLabel("2026-10-01T01:00:00.000Z", "2026-10-31")).toBe("1 Oct 2026");
  });

  it("formats thresholds as money", () => {
    expect(thresholdLabel(50_000)).toBe("S$500.00 or more");
  });
});

describe("requestName", () => {
  it("drops the kind when the title already names it", () => {
    expect(requestName("Overtime", "Overtime, 23 Oct 2026")).toBe("Overtime, 23 Oct 2026");
    expect(requestName("Claim", "Transport claim")).toBe("Transport claim");
    expect(requestName("Leave", "Annual leave, 28–29 Dec 2026")).toBe("Annual leave, 28–29 Dec 2026");
    expect(requestName("Payroll run", "October 2026 payroll")).toBe("October 2026 payroll");
  });

  it("keeps the kind when the title doesn't say what it is", () => {
    expect(requestName("Profile change", "Personal details")).toBe("Profile change: Personal details");
    expect(requestName("Profile change", "Personal details change")).toBe("Profile change: Personal details change");
    expect(requestName("Leave cancellation", "Annual leave, 2 Nov 2026")).toBe(
      "Leave cancellation: Annual leave, 2 Nov 2026",
    );
    expect(requestName("Shift swap", "Shift swap, Wed 4 Nov ↔ Wed 4 Nov")).toBe("Shift swap, Wed 4 Nov ↔ Wed 4 Nov");
    expect(requestName("Claim", "Team meal after stocktake")).toBe("Claim: Team meal after stocktake");
  });
});
