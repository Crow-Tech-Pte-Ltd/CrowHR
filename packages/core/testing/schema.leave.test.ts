import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leaveTypes } from "../src/db/schema/leave.ts";
import { DEFAULT_LEAVE_TYPES, ensureLeaveSetup } from "../src/leave/defaults.ts";
import { createTestDb, createTestDeps, seedEmployee, seedOrg, type TestDb } from "./index.ts";

describe("leave and attendance schema", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
  });
  afterAll(() => t.close());

  const TABLES = [
    "leave_types",
    "leave_settings",
    "leave_holidays",
    "leave_children",
    "leave_requests",
    "leave_request_days",
    "leave_attachments",
    "leave_ledger",
    "leave_year_closings",
    "attendance_settings",
    "attendance_punches",
    "overtime_claims",
  ];

  it("creates every table with a non-null org_id", async () => {
    const { rows } = await t.pglite.query<{ table_name: string; is_nullable: string }>(
      "select table_name, is_nullable from information_schema.columns where table_schema = 'public' and column_name = 'org_id'",
    );
    for (const name of TABLES) {
      expect(
        rows.find((r) => r.table_name === name),
        name,
      ).toMatchObject({ is_nullable: "NO" });
    }
  });

  it("rejects a leave request whose employee or type belongs to another organisation", async () => {
    const a = await seedOrg(deps);
    const b = await seedOrg(deps);
    await ensureLeaveSetup(deps, a.id);
    await ensureLeaveSetup(deps, b.id);
    const empB = await seedEmployee(deps, b.id);
    const empA = await seedEmployee(deps, a.id);
    const [typeB] = (await deps.db.select().from(leaveTypes)).filter((x) => x.orgId === b.id);
    const insert = (employeeId: string, typeId: string) =>
      t.pglite.query(
        `insert into leave_requests (id, org_id, employee_id, leave_type_id, start_date, end_date, start_session, end_session, unit, hundredths, status, requested_by_membership_id)
         values ($1, $2, $3, $4, '2026-11-10', '2026-11-10', 'full', 'full', 'days', 100, 'pending', $1)`,
        [deps.ids.newId(), a.id, employeeId, typeId],
      );
    await expect(insert(empB, typeB?.id as string)).rejects.toThrow(/leave_requests_employee_fk/);
    await expect(insert(empA, typeB?.id as string)).rejects.toThrow(/leave_requests_type_fk/);
    await expect(
      t.pglite.query(
        `insert into attendance_punches (id, org_id, employee_id, kind, idempotency_key, source, device_time, sent_at, server_time, recorded_at, work_date, skew_seconds)
         values ($1, $2, $3, 'in', 'k', 'web', now(), now(), now(), now(), '2026-11-10', 0)`,
        [deps.ids.newId(), a.id, empB],
      ),
    ).rejects.toThrow(/attendance_punches_employee_fk/);
  });

  it("statutory types are created once per organisation, lazily and idempotently", async () => {
    const org = await seedOrg(deps);
    await ensureLeaveSetup(deps, org.id);
    // A second deps object (another request / replica) runs the setup again: nothing duplicates.
    await ensureLeaveSetup(createTestDeps(t.db), org.id);
    const rows = (await deps.db.select().from(leaveTypes)).filter((x) => x.orgId === org.id);
    expect(rows.map((r) => r.code).sort()).toEqual(DEFAULT_LEAVE_TYPES.map((d) => d.code).sort());
    expect(rows.find((r) => r.code === "hospitalisation")).toMatchObject({
      attachment: "required",
      sensitive: true,
      paid: true,
    });
    expect(rows.find((r) => r.code === "infant_care")).toMatchObject({ paid: false });
  });
});
