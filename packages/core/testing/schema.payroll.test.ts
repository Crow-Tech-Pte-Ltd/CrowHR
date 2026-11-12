import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./index.ts";

const PAYROLL_TABLES = [
  "payroll_settings",
  "payroll_allowance_settings",
  "payroll_runs",
  "payroll_run_items",
  "payroll_payslips",
  "payroll_ir8a_appendix_entries",
];

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

describe("payroll schema", () => {
  it("creates every table with a non-null org_id", async () => {
    const cols = await t.pglite.query<{ table_name: string; is_nullable: string }>(
      "select table_name, is_nullable from information_schema.columns where table_schema = 'public' and column_name = 'org_id'",
    );
    const byTable = new Map(cols.rows.map((r) => [r.table_name, r.is_nullable]));
    for (const table of PAYROLL_TABLES) expect([table, byTable.get(table)]).toEqual([table, "NO"]);
  });

  it("stores money as bigint cents", async () => {
    const cols = await t.pglite.query<{ table_name: string; column_name: string; data_type: string }>(
      "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name like 'payroll_%' and column_name like '%cents'",
    );
    expect(cols.rows.length).toBeGreaterThanOrEqual(6);
    for (const c of cols.rows)
      expect([c.table_name, c.column_name, c.data_type]).toEqual([c.table_name, c.column_name, "bigint"]);
  });

  it("references other tenant tables through composite (org_id, id) foreign keys", async () => {
    const fks = await t.pglite.query<{ conname: string; cols: number }>(
      "select conname, array_length(conkey, 1) as cols from pg_constraint where contype = 'f' and conrelid::regclass::text like 'payroll_%' and conname not like '%org_id%'",
    );
    expect(fks.rows.length).toBeGreaterThanOrEqual(6);
    for (const fk of fks.rows) expect([fk.conname, fk.cols]).toEqual([fk.conname, 2]);
  });

  it("allows one regular run per organisation and month", async () => {
    await t.pglite.query(
      "insert into organisations (id, name, slug) values ('00000000-0000-7000-8000-000000000001', 'O', 'o')",
    );
    const insert = (id: string, kind: string) =>
      t.pglite.query(
        `insert into payroll_runs (id, org_id, kind, month, period_start, period_end, pay_date) values ('${id}', '00000000-0000-7000-8000-000000000001', '${kind}', '2026-10', '2026-10-01', '2026-10-31', '2026-10-31')`,
      );
    await insert("00000000-0000-7000-8000-0000000000a1", "regular");
    await expect(insert("00000000-0000-7000-8000-0000000000a2", "regular")).rejects.toThrow();
    await insert("00000000-0000-7000-8000-0000000000a3", "off_cycle");
  });
});
