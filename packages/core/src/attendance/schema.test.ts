import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedEmployee, seedOrg, type TestDb } from "../../testing/index.ts";

/** Attendance tables: org_id everywhere and composite FKs that reject cross-org references. */
describe("attendance schema", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
  });
  afterAll(() => t.close());

  it("every attendance table has a non-null org_id", async () => {
    const { rows } = await t.pglite.query<{ table_name: string; is_nullable: string }>(
      "select table_name, is_nullable from information_schema.columns where column_name = 'org_id' and table_name in ('attendance_settings', 'attendance_punches', 'overtime_claims')",
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      "attendance_punches",
      "attendance_settings",
      "overtime_claims",
    ]);
    expect(rows.every((r) => r.is_nullable === "NO")).toBe(true);
  });

  it("rejects a punch or claim pointing at another organisation's employee, and duplicate keys", async () => {
    const a = await seedOrg(deps);
    const b = await seedOrg(deps);
    const empB = await seedEmployee(deps, b.id);
    const empA = await seedEmployee(deps, a.id);
    const punch = (org: string, emp: string, key: string) =>
      t.pglite.query(
        `insert into attendance_punches (id, org_id, employee_id, kind, idempotency_key, source, device_time, sent_at, server_time, recorded_at, work_date, skew_seconds)
         values (gen_random_uuid(), $1, $2, 'in', $3, 'web', now(), now(), now(), now(), '2026-11-12', 0)`,
        [org, emp, key],
      );
    await expect(punch(a.id, empB, "k1")).rejects.toThrow(/attendance_punches_employee_fk/);
    await punch(a.id, empA, "k1");
    await expect(punch(a.id, empA, "k1")).rejects.toThrow(/attendance_punches_idempotency/);
    await expect(
      t.pglite.query(
        `insert into overtime_claims (id, org_id, employee_id, work_date, computed_minutes, claimed_minutes, statutory, status, created_by_membership_id)
         values (gen_random_uuid(), $1, $2, '2026-11-12', 60, 60, true, 'pending', gen_random_uuid())`,
        [a.id, empB],
      ),
    ).rejects.toThrow(/overtime_claims_employee_fk/);
  });
});
