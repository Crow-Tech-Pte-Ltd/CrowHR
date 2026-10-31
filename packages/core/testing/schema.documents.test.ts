import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDocumentSetup } from "../src/documents/defaults.ts";
import { createTestDb, createTestDeps, seedEmployee, seedMember, seedOrg, type TestDb } from "./index.ts";

/** add-documents task 1.1: tables, composite FKs, and default categories seeded per organisation. */
describe("documents schema", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let a: { id: string };
  let b: { id: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    a = await seedOrg(deps);
    b = await seedOrg(deps);
    await seedEmployee(deps, a.id);
    await seedMember(deps, a.id);
    await ensureDocumentSetup(deps.db, deps.ids, a.id);
    await ensureDocumentSetup(deps.db, deps.ids, b.id);
  });
  afterAll(() => t.close());

  it("creates the documents tables", async () => {
    const { rows } = await t.pglite.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "document_categories",
        "documents",
        "document_versions",
        "letter_templates",
        "document_views",
        "acknowledgement_requests",
        "document_requests",
        "document_retention_reviews",
      ]),
    );
  });

  it("seeds six default categories and five templates per organisation, once", async () => {
    await ensureDocumentSetup(deps.db, deps.ids, a.id);
    for (const org of [a.id, b.id]) {
      const cats = await t.pglite.query("select system_key from document_categories where org_id = $1", [org]);
      expect(cats.rows).toHaveLength(6);
      const tpl = await t.pglite.query("select kind from letter_templates where org_id = $1", [org]);
      expect(tpl.rows).toHaveLength(5);
    }
  });

  it("composite FKs reject a document in another organisation's category; medical can't be manager-visible", async () => {
    const [catB] = (
      await t.pglite.query<{ id: string }>("select id from document_categories where org_id = $1 limit 1", [b.id])
    ).rows;
    const [emp] = (await t.pglite.query<{ id: string }>("select id from employees where org_id = $1 limit 1", [a.id]))
      .rows;
    const [mem] = (await t.pglite.query<{ id: string }>("select id from memberships where org_id = $1 limit 1", [a.id]))
      .rows;
    await expect(
      t.pglite.query(
        "insert into documents (id, org_id, employee_id, category_id, title, created_by_membership_id) values ($1, $2, $3, $4, 'x', $5)",
        [deps.ids.newId(), a.id, emp?.id, catB?.id, mem?.id],
      ),
    ).rejects.toThrow(/documents_category_fk/);
    await expect(
      t.pglite.query(
        "update document_categories set manager_visible = true where org_id = $1 and system_key = 'medical'",
        [a.id],
      ),
    ).rejects.toThrow(/document_categories_medical_not_manager/);
  });
});
