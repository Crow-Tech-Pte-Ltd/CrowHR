import { describe, expect, it } from "vitest";
import { daysBetween, formatPhone, passExpiry } from "./format.ts";

describe("formatPhone", () => {
  it("groups Singapore numbers in fours after +65", () => {
    expect(formatPhone("+6591139289")).toBe("+65 9113 9289");
    expect(formatPhone("+65 9113-9289")).toBe("+65 9113 9289");
    expect(formatPhone("61234567")).toBe("6123 4567");
    expect(formatPhone(" 8765 4321 ")).toBe("8765 4321");
  });

  it("leaves other numbers as stored", () => {
    expect(formatPhone("+60123456789")).toBe("+60123456789");
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("12345678")).toBe("12345678");
  });

  it("has nothing to show for an empty value", () => {
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone("")).toBeNull();
  });
});

describe("passExpiry", () => {
  const today = "2026-10-31";
  it("says when an expired pass expired", () => {
    expect(passExpiry({ expiresOn: "2026-10-20", cancelledOn: null, state: "expired" }, today)).toBe(
      "Expired 20 Oct 2026",
    );
  });

  it("counts the days left while a pass is expiring", () => {
    expect(passExpiry({ expiresOn: "2026-12-19", cancelledOn: null, state: "expiring" }, today)).toBe(
      "Expires 19 Dec 2026 (49 days)",
    );
    expect(passExpiry({ expiresOn: "2026-11-01", cancelledOn: null, state: "expiring" }, today)).toBe(
      "Expires 1 Nov 2026 (1 day)",
    );
    expect(passExpiry({ expiresOn: today, cancelledOn: null, state: "expiring" }, today)).toBe(
      "Expires 31 Oct 2026 (today)",
    );
  });

  it("gives a valid pass's date without a count", () => {
    expect(passExpiry({ expiresOn: "2028-03-01", cancelledOn: null, state: "valid" }, today)).toBe(
      "Expires 1 Mar 2028",
    );
  });

  it("says when a pass was cancelled", () => {
    expect(passExpiry({ expiresOn: "2027-01-01", cancelledOn: "2026-10-01", state: "cancelled" }, today)).toBe(
      "Cancelled 1 Oct 2026",
    );
  });

  it("counts calendar days", () => {
    expect(daysBetween("2026-10-31", "2026-12-19")).toBe(49);
    expect(daysBetween("2026-10-31", "2026-10-20")).toBe(-11);
  });
});
