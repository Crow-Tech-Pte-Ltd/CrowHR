import { describe, expect, it } from "vitest";
import { ApiError } from "./lib/api.ts";
import {
  isExpectedError,
  readMonitoringConfig,
  redactText,
  reportError,
  rootErrorOptions,
  scrubBreadcrumb,
  scrubEvent,
} from "./monitoring.ts";

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

  it("never sends invitation or password-reset tokens (they are in the path)", () => {
    // What the TanStack Router integration and browser tracing record for /invite/$token.
    const url = "https://hr.acme.sg/invite/INVITE-TOKEN-1";
    const event = scrubEvent({
      type: "transaction",
      transaction: "/invite/$token",
      request: { url, headers: { "User-Agent": "Firefox" } },
      contexts: {
        trace: {
          trace_id: "t",
          span_id: "s",
          data: {
            "url.path": "/invite/INVITE-TOKEN-1",
            "url.full": url,
            "url.template": "/invite/$token",
            "url.path.parameter.token": "INVITE-TOKEN-1",
            "params.token": "INVITE-TOKEN-1",
          },
        },
      },
      spans: [
        { span_id: "a", trace_id: "t", start_timestamp: 0, status: "ok", description: url, data: { "url.full": url } },
      ],
      breadcrumbs: [{ category: "navigation", data: { from: "/reset/RESET-TOKEN-2?x=1", to: "/" } }],
    });
    const sent = JSON.stringify(event);
    expect(sent).not.toContain("INVITE-TOKEN-1");
    expect(sent).not.toContain("RESET-TOKEN-2");
    expect(event.request?.url).toBe("https://hr.acme.sg/invite/[token]");
    expect(event.contexts?.trace?.data).toEqual({
      "url.path": "/invite/[token]",
      "url.full": "https://hr.acme.sg/invite/[token]",
      "url.template": "/invite/$token",
    });
    expect(event.transaction).toBe("/invite/$token");
    expect(event.breadcrumbs?.[0]?.data).toEqual({ from: "/reset/[token]", to: "/" });
    // API paths that only contain the word are untouched.
    expect(redactText("/api/v1/auth/password-reset/inspect")).toBe("/api/v1/auth/password-reset/inspect");
  });

  it("masks element labels in click breadcrumbs and drops console breadcrumbs", () => {
    const event = scrubEvent({
      type: undefined,
      breadcrumbs: [
        { category: "ui.click", message: 'div.row > button.icon[aria-label="Actions for Tan Ah Kow"]' },
        { category: "console", message: "tan@acme.sg is already a member of this organisation." },
      ],
    });
    expect(event.breadcrumbs).toEqual([
      { category: "ui.click", message: 'div.row > button.icon[aria-label="[redacted]"]' },
    ]);
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
  });
});
