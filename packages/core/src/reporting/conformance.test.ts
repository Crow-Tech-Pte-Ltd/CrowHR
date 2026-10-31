import { inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import { seedMember } from "../../testing/fixtures.ts";
import { clientAs, type TestClient } from "../../testing/http.ts";
import { seedOrg } from "../../testing/index.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import type { Grant } from "../access/authorize.ts";
import { CORE_REPORT_SOURCES } from "./registry.ts";
import type { ReportContext, ReportRow } from "./types.ts";

/**
 * Conformance (add-reporting task 1.3, design risk "modules forgetting to apply scope"): every
 * registered definition, run with a scope, returns only rows in that scope; run as another
 * organisation's owner, it returns nothing.
 */
const DEFINITIONS = CORE_REPORT_SOURCES.flatMap((s) => s.reports);

function scopedGrant(ids: ReadonlySet<string>): Grant {
  return {
    permission: "reports_leave:read",
    scopes: new Set(["team"]),
    roles: new Set(["manager"]),
    all: false,
    employeeIds: async () => ids,
    canAccessEmployee: async (id) => ids.has(id),
    assertEmployee: async () => {},
    employeeFilter: async (column) => (ids.size ? inArray(column as PgColumn, [...ids]) : sql`false`),
  };
}

async function rowsOf(w: LeaveWorld, id: string, ids: ReadonlySet<string>): Promise<ReportRow[]> {
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(id);
  const ctx: ReportContext = {
    db: w.deps.db,
    deps: w.deps,
    orgId: w.orgId,
    today: "2026-11-13",
    now: w.clock.now(),
    employeeIds: ids,
    grant: scopedGrant(ids),
  };
  const params = def.params({ today: ctx.today }).parse({});
  const out: ReportRow[] = [];
  for await (const batch of def.run(ctx, params)) out.push(...batch);
  return out;
}

describe("report definitions apply the scope they are given", () => {
  let w: LeaveWorld;
  let otherOwner: TestClient;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
    const staff = await w.as("staff");
    const sent = "2026-11-13T02:00:00.000Z";
    await punch(staff, "in", "2026-11-10T01:12:00.000Z", { sentAt: sent, queued: true });
    await punch(await w.as("other"), "in", "2026-11-10T01:00:00.000Z", { sentAt: sent, queued: true });
    const b = await seedOrg(w.deps, { slug: "conformance-b" });
    otherOwner = await clientAs(w.app, w.deps, await seedMember(w.deps, b.id, { roles: ["owner"] }));
  });
  afterAll(() => w.close());

  it.each(DEFINITIONS.map((d) => d.id))("%s returns nothing for an empty scope", async (id) => {
    expect(await rowsOf(w, id, new Set())).toEqual([]);
  });

  it.each(DEFINITIONS.map((d) => d.id))("%s returns nothing to another organisation's owner", async (id) => {
    const res = await otherOwner.get(`/api/v1/reports/${id}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { totalRows: number; totals: unknown };
    expect(body.totalRows).toBe(0);
    expect(body.totals).toBeNull();
  });

  it("team-scoped definitions return only the team's employees", async () => {
    const team = new Set([w.emp.staff, w.emp.newbie]);
    const names = new Set(["Ravi Kumar", "Siti Rahmah"]);
    for (const def of DEFINITIONS.filter((d) => (d.scopes ?? ["all", "team"]).includes("team"))) {
      const rows = await rowsOf(w, def.id, team);
      for (const r of rows) {
        const name = r.name ?? r.employee;
        if (name !== undefined) expect(names.has(String(name)), `${def.id}: ${name}`).toBe(true);
      }
    }
    // And through HTTP as the manager (whose team is staff, newbie, partTimer, satRest).
    const manager = await w.as("manager");
    const body = (await (
      await manager.get("/api/v1/reports/attendance.exceptions?from=2026-11-09&to=2026-11-13")
    ).json()) as {
      rows: { name: string }[];
    };
    expect(body.rows.map((r) => r.name)).not.toContain("Farah Hassan");
  });
});
