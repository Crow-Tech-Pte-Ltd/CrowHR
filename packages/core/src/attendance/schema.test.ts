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
      "select table_name, is_nullable from information_schema.columns where column_name = 'org_id' and table_name in ('attendance_settings', 'attendance_punches', 'overtime_claims', 'attendance_timesheets')",
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      "attendance_punches",
      "attendance_settings",
      "attendance_timesheets",
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

  it("timesheets: cross-org employee rejected, one open or approved per period start, ordered range", async () => {
    const a = await seedOrg(deps);
    const b = await seedOrg(deps);
    const empA = await seedEmployee(deps, a.id);
    const empB = await seedEmployee(deps, b.id);
    const sheet = (org: string, emp: string, status: string, start = "2026-10-01", end = "2026-10-31") =>
      t.pglite.query(
        `insert into attendance_timesheets (id, org_id, employee_id, period_start, period_end, status, submitted_by_membership_id, submitted_at, submitted_totals)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, gen_random_uuid(), now(), '{}'::jsonb)`,
        [org, emp, start, end, status],
      );
    await expect(sheet(a.id, empB, "submitted")).rejects.toThrow(/attendance_timesheets_employee_fk/);
    await sheet(a.id, empA, "returned");
    await sheet(a.id, empA, "submitted");
    await expect(sheet(a.id, empA, "approved")).rejects.toThrow(/attendance_timesheets_one_open/);
    await expect(sheet(a.id, empA, "submitted", "2026-11-30", "2026-11-01")).rejects.toThrow(
      /attendance_timesheets_period_order/,
    );
  });
});
