import { describe, expect, it } from "vitest";
import { diagnostics, requestReference, supportEmail } from "./diagnostics.ts";

describe("support diagnostics", () => {
  it("shares an explicit list of fields and omits identifiers and server configuration", () => {
    const facts = {
      topic: "Payroll and payslips",
      version: "1.1.1",
      time: "2026-11-28T12:00:00.000Z",
      reference: "1b9b6af7-7c2a-4b51-b6c4-1d60134aecb1",
      publicUrl: "https://payroll.private.example",
      error: "Employee name and salary",
      host: "192.168.1.20",
    };
    expect(diagnostics(facts)).toEqual(
      [
        "Area: Payroll and payslips",
        "Version: 1.1.1",
        "Checked at: 2026-11-28T12:00:00.000Z",
        "Request reference: 1b9b6af7-7c2a-4b51-b6c4-1d60134aecb1",
      ].join("\n"),
    );
  });

  it("drops unrecognised values and uses a fixed email subject", () => {
    expect(requestReference("a@company.example")).toBeUndefined();
    expect(requestReference("unknown")).toBeUndefined();
    expect(diagnostics({ topic: "Server", version: "1.1.1\nPrivate text", time: "bad" })).toBe("Area: Server");
    const url = new URL(supportEmail("safe facts"));
    expect(url.pathname).toBe("hello@crowhr.com");
    expect(url.searchParams.get("subject")).toBe("[Crow HR] Support");
    expect(url.searchParams.get("body")).toContain("safe facts");
  });
});
