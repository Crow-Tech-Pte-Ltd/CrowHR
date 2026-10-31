/**
 * The roles-and-permissions page renders packages/core/src/access/matrix.ts at build time, so the
 * cells cannot drift. These tests make sure the rendering covers every row and that each resource
 * has a human label.
 */
import { describe, expect, it } from "vitest";
import { MATRIX, ROLES } from "../../../packages/core/src/access/matrix.ts";
import { matrixGroups, NOT_BUILT_RESOURCES, RESOURCE_LABELS } from "../src/lib/permissions.ts";

describe("permission matrix page", () => {
  const groups = matrixGroups();

  it("renders every permission of the matrix exactly once, with every role", () => {
    const rendered = groups.flatMap((g) => g.rows);
    expect(rendered.map((r) => r.permission).sort()).toEqual(Object.keys(MATRIX).sort());
    for (const row of rendered) expect(row.cells.map((c) => c.role)).toEqual([...ROLES]);
  });

  it("copies each cell from the matrix", () => {
    for (const row of groups.flatMap((g) => g.rows)) {
      const cells: Record<string, string | undefined> = MATRIX[row.permission as keyof typeof MATRIX].cells;
      for (const cell of row.cells) expect(cell.scope).toBe(cells[cell.role] ?? null);
    }
  });

  it("has a plain-language label for every resource", () => {
    const resources = [...new Set(Object.keys(MATRIX).map((p) => p.split(":")[0] as string))];
    const unlabelled = resources.filter((r) => !RESOURCE_LABELS[r]);
    expect(unlabelled, "Add labels in apps/docs/src/lib/permissions.ts").toEqual([]);
  });

  it("marks only resources that exist in the matrix as not built", () => {
    const resources = new Set(Object.keys(MATRIX).map((p) => p.split(":")[0]));
    expect([...NOT_BUILT_RESOURCES].filter((r) => !resources.has(r))).toEqual([]);
  });
});
