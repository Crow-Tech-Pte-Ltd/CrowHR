import { describe, expect, it } from "vitest";
import snapshot from "../../../packages/core/openapi/v1.snapshot.json" with { type: "json" };
import { apiTagSlug } from "../src/lib/api-tags.ts";
import {
  childProperties,
  constraints,
  groupByTag,
  type OpenApiDocument,
  operationAnchor,
  splitNullable,
  typeLabel,
} from "../src/lib/openapi.ts";

const doc = snapshot as unknown as OpenApiDocument;

describe("API reference helpers", () => {
  it("groups every operation of the snapshot under exactly one tag page", () => {
    const groups = groupByTag(doc);
    const total = Object.values(doc.paths).reduce((n, ops) => n + Object.keys(ops).length, 0);
    expect(groups.reduce((n, g) => n + g.operations.length, 0)).toBe(total);
    const anchors = groups.flatMap((g) => g.operations.map((o) => o.anchor));
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(new Set(groups.map((g) => g.slug)).size).toBe(groups.length);
  });

  it("makes stable slugs and anchors", () => {
    expect(apiTagSlug("Members and roles")).toBe("members-and-roles");
    expect(operationAnchor("get", "/api/v1/payroll/runs/{runId}")).toBe("get-api-v1-payroll-runs-runid");
  });

  it("labels types readably", () => {
    expect(typeLabel({ type: "string", format: "uuid" })).toBe("string (uuid)");
    expect(typeLabel({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string or null");
    expect(typeLabel({ type: "array", items: { type: "object", properties: {} } })).toBe("array of object");
    expect(typeLabel({ type: "string", enum: ["a", "b"] })).toBe("enum");
    expect(constraints({ type: "string", enum: ["a", "b"] })).toEqual(['one of "a", "b"']);
  });

  it("unwraps nullable objects and arrays to their properties", () => {
    const obj = { type: "object", properties: { a: { type: "integer" } }, required: ["a"] };
    expect(splitNullable({ anyOf: [obj, { type: "null" }] }).nullable).toBe(true);
    expect(childProperties({ anyOf: [obj, { type: "null" }] })).toEqual([
      { name: "a", schema: { type: "integer" }, required: true },
    ]);
    expect(childProperties({ type: "array", items: obj }).map((p) => p.name)).toEqual(["a"]);
  });
});
