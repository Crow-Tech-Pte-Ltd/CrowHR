import { AppError } from "@crowhr/core";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { activeMonitoring, DATA_COLLECTION, sampleTrace, scrubEvent, shouldReportError } from "./sentry.ts";

type Ctx = Parameters<typeof sampleTrace>[0];
const ctx = (fields: Partial<Ctx>): Ctx => ({
  name: "GET /",
  attributes: {},
  inheritOrSampleWith: (rate: number) => rate,
  ...fields,
});

describe("server monitoring", () => {
  it("is not started without a DSN", () => {
    expect(activeMonitoring()).toBeNull();
  });

  it("collects no personal data (SDK 11 collects all of it by default)", () => {
    expect(DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    });
    expect(DATA_COLLECTION.httpHeaders.response).toBe(false);
    expect(DATA_COLLECTION.httpHeaders.request.allow).not.toContain("cookie");
    expect(DATA_COLLECTION.httpHeaders.request.allow).not.toContain("authorization");
  });

  it("scrubs request data, user and breadcrumb queries from events", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://hr.acme.sg/api/v1/employees?search=Tan#top",
        method: "POST",
        query_string: "search=Tan",
        cookies: { __Host_session: "secret" },
        data: { nric: "S1234567D" },
        headers: {
          "User-Agent": "Firefox",
          Cookie: "__Host_session=secret",
          Authorization: "Bearer x",
          "X-Request-Id": "r1",
        },
      },
      user: { id: "u1", ip_address: "203.0.113.9", email: "tan@acme.sg" },
      breadcrumbs: [{ category: "fetch", data: { url: "/api/v1/employees?search=Tan", status_code: 200 } }],
    });
    expect(event.request).toEqual({
      url: "https://hr.acme.sg/api/v1/employees",
      method: "POST",
      headers: { "User-Agent": "Firefox", "X-Request-Id": "r1" },
    });
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "/api/v1/employees", status_code: 200 });
  });

  it("reports unexpected errors and 5xx, not AppError or client errors", () => {
    expect(shouldReportError(new Error("boom"))).toBe(true);
    expect(shouldReportError("thrown string")).toBe(true);
    expect(shouldReportError(new HTTPException(500))).toBe(true);
    expect(shouldReportError(new HTTPException(400))).toBe(false);
    expect(shouldReportError(new AppError("forbidden", "No."))).toBe(false);
    expect(shouldReportError(new AppError("not_implemented", "Later."))).toBe(false);
  });

  it("traces API requests at the configured rate, never health checks or static files", () => {
    const inherit = vi.fn((rate: number) => rate);
    expect(sampleTrace(ctx({ name: "GET /api/v1/employees", inheritOrSampleWith: inherit }), 0.2)).toBe(0.2);
    expect(inherit).toHaveBeenCalledWith(0.2);
    expect(sampleTrace(ctx({ normalizedRequest: { url: "http://127.0.0.1:8080/api/v1/me?x=1" } }), 0.2)).toBe(0.2);
    expect(sampleTrace(ctx({ name: "GET /api/health" }), 1)).toBe(0);
    expect(sampleTrace(ctx({ normalizedRequest: { url: "/api/health" } }), 1)).toBe(0);
    expect(sampleTrace(ctx({ name: "GET /assets/index-abc.js" }), 1)).toBe(0);
    expect(sampleTrace(ctx({ name: "GET /payroll" }), 1)).toBe(0);
    // Not a request (e.g. a background job span): the configured rate.
    expect(sampleTrace(ctx({ name: "backup" }), 0.5)).toBe(0.5);
  });
});
