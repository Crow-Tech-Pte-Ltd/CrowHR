import { describe, expect, it } from "vitest";
import { ApiError } from "./lib/api.ts";
import { isExpectedError, readMonitoringConfig, reportError, rootErrorOptions, scrubEvent } from "./monitoring.ts";

/** A document whose only meta tag has this content (as the server writes it). */
const page = (content: string | null) => ({
  querySelector: (selector: string) =>
    content !== null && selector === 'meta[name="crowhr-monitoring"]'
      ? ({ getAttribute: (name: string) => (name === "content" ? content : null) } as unknown as Element)
      : null,
});

describe("browser monitoring", () => {
  it("is off unless the server put settings in the page", () => {
    expect(readMonitoringConfig(page(null))).toBeNull();
    expect(readMonitoringConfig(page("not json"))).toBeNull();
    expect(readMonitoringConfig(page('{"dsn":""}'))).toBeNull();
    // Not started: nothing to report to, no root hooks.
    expect(() => reportError(new Error("x"))).not.toThrow();
    expect(rootErrorOptions()).toEqual({});
  });

  it("reads the server's settings", () => {
    const config = readMonitoringConfig(
      page(
        '{"dsn":"https://k@glitchtip.example.sg/8","environment":"staging","release":"crowhr@1","tracesSampleRate":0.2}',
      ),
    );
    expect(config).toEqual({
      dsn: "https://k@glitchtip.example.sg/8",
      environment: "staging",
      release: "crowhr@1",
      tracesSampleRate: 0.2,
    });
    expect(
      readMonitoringConfig(page('{"dsn":"https://k@g.example.sg/8","tracesSampleRate":7}'))?.tracesSampleRate,
    ).toBe(0);
  });

  it("does not report API errors (the server reports its own 5xx)", () => {
    expect(isExpectedError(new ApiError(403, null))).toBe(true);
    expect(isExpectedError(new ApiError(500, null))).toBe(true);
    expect(isExpectedError(new TypeError("x is undefined"))).toBe(false);
  });

  it("scrubs query strings, cookies, referrer and user from events", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://hr.acme.sg/employees?q=Tan",
        headers: { "User-Agent": "Firefox", Referer: "https://hr.acme.sg/employees?q=Tan" },
        cookies: { a: "b" },
      },
      user: { ip_address: "{{auto}}" },
      breadcrumbs: [{ category: "navigation", data: { from: "/employees?q=Tan", to: "/payroll#x" } }],
    });
    expect(event.request).toEqual({ url: "https://hr.acme.sg/employees", headers: { "User-Agent": "Firefox" } });
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.data).toEqual({ from: "/employees", to: "/payroll" });
  });
});
