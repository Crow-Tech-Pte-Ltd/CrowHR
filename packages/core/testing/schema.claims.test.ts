import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedClaimsOnePerTable } from "../src/testing/claims-sweep.ts";
import { createTestDb, createTestDeps, seedEmployee, seedMember, seedOrg, type TestDb } from "./index.ts";

describe("claims schema", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let a: { id: string };
  let b: { id: string };
  let seededB: Awaited<ReturnType<typeof seedClaimsOnePerTable>>;
  let memberA: Awaited<ReturnType<typeof seedMember>>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    a = await seedOrg(deps);
    b = await seedOrg(deps);
    memberA = await seedMember(deps, a.id, { employeeId: deps.ids.newId() });
    const memberB = await seedMember(deps, b.id, { employeeId: deps.ids.newId() });
    seededB = await seedClaimsOnePerTable(deps, b.id, memberB.membershipId);
    await seedEmployee(deps, a.id);
  });
  afterAll(() => t.close());

  it("creates the claims tables and the shared files and org_counters tables", async () => {
    const { rows } = await t.pglite.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "claim_types",
        "claim_settings",
        "claims",
        "claim_lines",
        "claim_line_files",
        "files",
        "org_counters",
      ]),
    );
  });

  it("composite FKs reject a line on another organisation's claim, type or file", async () => {
    await expect(
      t.pglite.query(
        `insert into claim_lines (id, org_id, claim_id, position, claim_type_id, expense_date, merchant, description, currency, currency_exponent, amount_minor, sgd_cents)
         values ($1, $2, $3, 5, $4, '2026-10-30', 'x', 'x', 'SGD', 2, 100, 100)`,
        [deps.ids.newId(), a.id, seededB.claimId, seededB.typeId],
      ),
    ).rejects.toThrow(/claim_lines_claim_fk|claim_lines_type_fk/);
    await expect(
      t.pglite.query(`insert into claim_line_files (org_id, claim_line_id, file_id, position) values ($1, $2, $3, 9)`, [
        a.id,
        seededB.lineId,
        deps.ids.newId(),
      ]),
    ).rejects.toThrow(/claim_line_files_(line|file)_fk/);
    // A claim for another organisation's employee.
    const [emp] = (await t.pglite.query<{ id: string }>("select id from employees where org_id = $1 limit 1", [b.id]))
      .rows;
    await expect(
      t.pglite.query(
        `insert into claims (id, org_id, employee_id, status, created_by_membership_id) values ($1, $2, $3, 'draft', $4)`,
        [deps.ids.newId(), a.id, emp?.id, memberA.membershipId],
      ),
    ).rejects.toThrow(/claims_employee_fk/);
  });

  it("money and state constraints: positive amounts, GST ≤ amount, paid ⇔ paid_on, SGD ⇔ no rate", async () => {
    const line = (overrides: string) =>
      t.pglite.query(
        `insert into claim_lines (id, org_id, claim_id, position, claim_type_id, expense_date, merchant, description, currency, currency_exponent, amount_minor, rate_micros, sgd_cents, gst_cents)
         values ${overrides}`,
        [],
      );
    const base = (pos: number, rest: string) =>
      `('${deps.ids.newId()}', '${b.id}', '${seededB.claimId}', ${pos}, '${seededB.typeId}', '2026-10-30', 'x', 'x', ${rest})`;
    await expect(line(base(10, "'SGD', 2, 0, null, 0, null"))).rejects.toThrow(/claim_lines_amount_check/);
    await expect(line(base(11, "'SGD', 2, 100, null, 100, 101"))).rejects.toThrow(/claim_lines_gst_check/);
    await expect(line(base(12, "'SGD', 2, 100, 1000000, 100, null"))).rejects.toThrow(/claim_lines_rate_check/);
    await expect(line(base(13, "'MYR', 2, 100, null, 30, null"))).rejects.toThrow(/claim_lines_rate_check/);
    await expect(t.pglite.query(`update claims set status = 'paid' where id = $1`, [seededB.claimId])).rejects.toThrow(
      /claims_paid_check/,
    );
    await expect(
      t.pglite.query(`update claims set payroll_run_id = $2 where id = $1`, [seededB.draftId, deps.ids.newId()]),
    ).rejects.toThrow(/claims_reserved_check/);
    // Claim numbers are unique per organisation.
    await expect(
      t.pglite.query(`update claims set claim_number = 'C-0001' where id = $1`, [seededB.draftId]),
    ).rejects.toThrow(/claims_org_number_unique/);
  });
});
