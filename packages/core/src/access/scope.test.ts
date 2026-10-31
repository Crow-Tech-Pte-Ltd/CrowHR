import { describe, expect, it } from "vitest";
import { createStaticReportingScope, singaporeDate } from "./scope.ts";

describe("ReportingScopeResolver test double", () => {
  const resolver = createStaticReportingScope({
    a: ["b"],
    b: ["c", "d"],
    c: ["e"],
    x: ["y"],
    y: ["x"], // cycle
  });

  it("includes direct and indirect reports", async () => {
    expect([...(await resolver.teamOf("org", "a", "2026-10-31"))].sort()).toEqual(["b", "c", "d", "e"]);
    expect([...(await resolver.teamOf("org", "b", "2026-10-31"))].sort()).toEqual(["c", "d", "e"]);
  });

  it("terminates on cycles and never includes the manager", async () => {
    expect([...(await resolver.teamOf("org", "x", "2026-10-31"))]).toEqual(["y"]);
  });

  it("is empty for someone without reports", async () => {
    expect((await resolver.teamOf("org", "e", "2026-10-31")).size).toBe(0);
  });

  it("dates in Asia/Singapore", () => {
    expect(singaporeDate(new Date("2026-10-31T15:59:59Z"))).toBe("2026-10-31");
    expect(singaporeDate(new Date("2026-10-31T16:00:00Z"))).toBe("2026-11-01");
  });
});
