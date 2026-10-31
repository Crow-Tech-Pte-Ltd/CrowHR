import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organisations } from "../src/db/schema/index.ts";
import { createTestDb, type TestDb } from "./index.ts";

const PEOPLE_TABLES = [
  "company_profiles",
  "departments",
  "teams",
  "locations",
  "cost_centres",
  "work_schedules",
  "work_schedule_versions",
  "employees",
  "emergency_contacts",
  "bank_accounts",
  "work_passes",
  "tenures",
  "lifecycle_events",
  "employment_records",
  "compensation_records",
  "allowance_types",
  "recurring_allowances",
  "ytd_opening_balances",
  "import_jobs",
  "checklist_templates",
  "checklist_template_items",
  "checklists",
  "checklist_items",
  "profile_change_requests",
];

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

describe("people schema", () => {
  it("creates every table with a non-null org_id", async () => {
    const cols = await t.pglite.query<{ table_name: string; is_nullable: string }>(
      "select table_name, is_nullable from information_schema.columns where table_schema = 'public' and column_name = 'org_id'",
    );
    const byTable = new Map(cols.rows.map((r) => [r.table_name, r.is_nullable]));
    for (const table of PEOPLE_TABLES) expect([table, byTable.get(table)]).toEqual([table, "NO"]);
  });

  it("money columns are bigint, never numeric or real", async () => {
    const cols = await t.pglite.query<{ column_name: string; data_type: string }>(
      "select column_name, data_type from information_schema.columns where table_schema = 'public' and column_name like '%cents'",
    );
    expect(cols.rows.length).toBeGreaterThan(5);
    for (const c of cols.rows) expect([c.column_name, c.data_type]).toEqual([c.column_name, "bigint"]);
  });

  it("composite FKs reject cross-org references; id_number_hmac unique per org", async () => {
    const a = "0192e0b4-0000-7000-8000-00000000000a";
    const b = "0192e0b4-0000-7000-8000-00000000000b";
    await t.db.insert(organisations).values([
      { id: a, name: "A" },
      { id: b, name: "B" },
    ]);
    const dept = "0192e0b4-0000-7000-8000-0000000000d1";
    await t.pglite.query("insert into departments (id, org_id, name) values ($1, $2, 'Sales')", [dept, a]);
    await expect(
      t.pglite.query("insert into teams (id, org_id, name, department_id) values (gen_random_uuid(), $1, 'T', $2)", [
        b,
        dept,
      ]),
    ).rejects.toThrow(/foreign key/);
    const emp = (id: string, org: string, hmac: string, no: string) =>
      t.pglite.query(
        "insert into employees (id, org_id, employee_number, legal_name, id_type, id_number_enc, id_number_hmac, id_number_masked, dob, residency_status) values ($1, $2, $3, 'X', 'nric', 'enc', $4, 'S****567D', '1990-01-01', 'citizen')",
        [id, org, no, hmac],
      );
    await emp("0192e0b4-0000-7000-8000-0000000000e1", a, "h1", "E0001");
    await expect(emp("0192e0b4-0000-7000-8000-0000000000e2", a, "h1", "E0002")).rejects.toThrow(/unique/);
    await emp("0192e0b4-0000-7000-8000-0000000000e3", b, "h1", "E0001"); // same person in another org is fine
  });
});
