import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../../testing/index.ts";
import { employmentRecords } from "../../db/schema/employees.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "../../testing/people-harness.ts";
import { applyEvent, ctxFor, hire } from "../lifecycle.ts";
import { createReportingScopeResolver, MAX_REPORTING_DEPTH } from "./reporting-scope.ts";

let t: TestDb;
let h: PeopleHarness;
let s: BasicStructure;
beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
  s = await seedBasicStructure(h);
});
afterEach(() => t.close());

const ctx = () => ctxFor(h.deps, h.ports, h.actor(OWNER));
const hireUnder = async (managerEmployeeId?: string, hireDate = "2026-01-05") =>
  (await hire(ctx(), hirePayload(s, { job: { managerEmployeeId, hireDate } }))).employeeId;

describe("ReportingScopeResolver", () => {
  it("direct and indirect reports, excluding the manager", async () => {
    const a = await hireUnder();
    const b = await hireUnder(a);
    const c = await hireUnder(b);
    const d = await hireUnder();
    const r = createReportingScopeResolver(t.db);
    expect([...(await r.teamOf(h.orgId, a, "2026-10-31"))].sort()).toEqual([b, c].sort());
    expect([...(await r.teamOf(h.orgId, b, "2026-10-31"))]).toEqual([c]);
    expect((await r.teamOf(h.orgId, d, "2026-10-31")).size).toBe(0);
    expect(await r.directReportsOf(h.orgId, a, "2026-10-31")).toEqual([b]);
  });

  it("as at a date: a manager change effective yesterday removes the old manager's access", async () => {
    const b = await hireUnder();
    const d = await hireUnder();
    const c = await hireUnder(b);
    await applyEvent(ctx(), c, { type: "transfer", effectiveDate: "2026-10-30", changes: { managerEmployeeId: d } });
    const r = createReportingScopeResolver(t.db);
    expect((await r.teamOf(h.orgId, b, "2026-10-31")).has(c)).toBe(false);
    expect((await r.teamOf(h.orgId, d, "2026-10-31")).has(c)).toBe(true);
    expect((await r.teamOf(h.orgId, b, "2026-10-29")).has(c)).toBe(true);
  });

  it("terminates on a cycle in bad data and caps depth", async () => {
    const a = await hireUnder();
    const b = await hireUnder(a);
    // Corrupt data directly (the service would refuse this): a reports to b.
    await t.pglite.query("update employment_records set manager_employee_id = $1 where employee_id = $2", [b, a]);
    const r = createReportingScopeResolver(t.db);
    const team = await r.teamOf(h.orgId, a, "2026-10-31");
    expect(team.has(b)).toBe(true);
    expect(team.has(a)).toBe(false);
    let prev = await hireUnder();
    const top = prev;
    for (let i = 0; i < MAX_REPORTING_DEPTH + 3; i++) prev = await hireUnder(prev);
    const deep = await r.teamOf(h.orgId, top, "2026-10-31");
    expect(deep.size).toBe(MAX_REPORTING_DEPTH);
  });

  it("is org-scoped", async () => {
    const a = await hireUnder();
    await hireUnder(a);
    const r = createReportingScopeResolver(t.db);
    expect((await r.teamOf(h.deps.ids.newId(), a, "2026-10-31")).size).toBe(0);
    expect(employmentRecords).toBeDefined();
  });
});
