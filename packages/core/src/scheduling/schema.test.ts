import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedEmployee, seedOrg, type TestDb } from "../../testing/index.ts";

/** Scheduling tables: org_id everywhere, one roster per scope-week, composite FKs, one open swap per shift. */
const TABLES = [
  "published_shifts",
  "roster_publications",
  "roster_shifts",
  "rosters",
  "shift_swaps",
  "shift_templates",
];

describe("scheduling schema", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
  });
  afterAll(() => t.close());

  it("every scheduling table has a non-null org_id", async () => {
    const { rows } = await t.pglite.query<{ table_name: string; is_nullable: string }>(
      `select table_name, is_nullable from information_schema.columns where column_name = 'org_id' and table_name in (${TABLES.map((x) => `'${x}'`).join(", ")})`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(TABLES);
    expect(rows.every((r) => r.is_nullable === "NO")).toBe(true);
  });

  it("one roster per scope and week; cross-org references and a second open swap are rejected", async () => {
    const a = await seedOrg(deps);
    const b = await seedOrg(deps);
    const empA = await seedEmployee(deps, a.id);
    const empB = await seedEmployee(deps, b.id);
    const roster = (org: string, key: string) =>
      t.pglite.query<{ id: string }>(
        `insert into rosters (id, org_id, scope_key, week_start) values (gen_random_uuid(), $1, $2, '2026-11-02') returning id`,
        [org, key],
      );
    const r = (await roster(a.id, "loc:*")).rows[0]?.id as string;
    await expect(roster(a.id, "loc:*")).rejects.toThrow(/rosters_scope_week_unique/);
    await roster(b.id, "loc:*"); // the same key in another organisation is fine
    const shift = (emp: string) =>
      t.pglite.query<{ id: string }>(
        `insert into roster_shifts (id, org_id, roster_id, employee_id, date) values (gen_random_uuid(), $1, $2, $3, '2026-11-03') returning id`,
        [a.id, r, emp],
      );
    await expect(shift(empB)).rejects.toThrow(/roster_shifts_employee_fk/);
    const s = (await shift(empA)).rows[0]?.id as string;
    const swap = () =>
      t.pglite.query(
        `insert into shift_swaps (id, org_id, roster_id, kind, shift_id, requester_employee_id, status, created_by_membership_id, expires_at)
         values (gen_random_uuid(), $1, $2, 'pickup', $3, $4, 'pending_approval', gen_random_uuid(), now())`,
        [a.id, r, s, empA],
      );
    await swap();
    await expect(swap()).rejects.toThrow(/shift_swaps_one_open/);
  });
});
