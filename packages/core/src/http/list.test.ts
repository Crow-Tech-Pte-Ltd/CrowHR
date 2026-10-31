import { describe, expect, it } from "vitest";
import { z } from "zod";
import { csvEnum, listQuery, pageOf, parseSort, toLimitOffset } from "./list.ts";

const q = listQuery({
  sort: ["name", "createdAt"],
  defaultSort: "-createdAt",
  search: true,
  filters: { status: csvEnum(["active", "invited", "suspended"]) },
});

describe("list conventions", () => {
  it("applies defaults", () => {
    expect(q.parse({})).toEqual({ page: 1, pageSize: 50, sort: "-createdAt" });
  });

  it("coerces query strings and parses comma-separated filters", () => {
    expect(q.parse({ page: "3", pageSize: "20", sort: "name", q: " tan ", status: "active,invited" })).toEqual({
      page: 3,
      pageSize: 20,
      sort: "name",
      q: "tan",
      status: ["active", "invited"],
    });
  });

  it("rejects unknown sort fields, oversize pages and bad filter values with fix-it messages", () => {
    const r = q.safeParse({ sort: "salary", pageSize: "500", status: "active,gone" });
    expect(r.success).toBe(false);
    const messages = r.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];
    expect(messages.join("\n")).toContain("sort: Sort by one of: name, -name, createdAt, -createdAt");
    expect(messages.some((m) => m.startsWith("pageSize"))).toBe(true);
    expect(messages.join("\n")).toContain("Use one or more of: active, invited, suspended");
  });

  it("computes limit/offset and sort direction", () => {
    expect(toLimitOffset({ page: 3, pageSize: 20 })).toEqual({ limit: 20, offset: 40 });
    expect(parseSort("-createdAt")).toEqual({ field: "createdAt", direction: "desc" });
    expect(parseSort("name")).toEqual({ field: "name", direction: "asc" });
  });

  it("describes the page envelope", () => {
    const page = pageOf(z.object({ id: z.string() }));
    expect(page.parse({ items: [{ id: "a" }], page: 1, pageSize: 50, total: 1 }).total).toBe(1);
  });
});
