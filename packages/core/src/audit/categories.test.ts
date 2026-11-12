import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, not } from "drizzle-orm";
import ts from "typescript";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedOrg, type TestDb } from "../../testing/index.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { auditCategory, auditCategorySql, recordAudit, systemAuditContext } from "./audit.ts";

// Explicit classification: adding a new family requires reviewing its read permissions.
const families = {
  security: ["security_settings", "sso"],
  payroll: ["payroll", "payslip", "compensation", "bank", "bank_account"],
  general: [
    "allowance_type",
    "approval",
    "approval_policy",
    "attendance",
    "audit_log",
    "auth",
    "checklist_item",
    "checklist_template",
    "claim",
    "claim_settings",
    "claim_type",
    "claims",
    "company_profile",
    "demo_company",
    "document",
    "document_category",
    "employee",
    "employees",
    "file",
    "leave",
    "letter_template",
    "lifecycle",
    "member",
    "nric",
    "profile_change",
    "report",
    "scheduling",
    "setup",
    "work_pass",
    "work_schedule",
    "import",
    "department",
    "team",
    "location",
    "cost_centre",
  ],
};
const structure = ["department", "team", "location", "cost_centre"];
const combine = (prefixes: string[], suffixes: string[]) => prefixes.flatMap((p) => suffixes.map((s) => `${p}.${s}`));
const dynamicActions: Record<string, string[]> = {
  '`profile_change.${input.decision === "approve" ? "approved" : "rejected"}`': combine(
    ["profile_change"],
    ["approved", "rejected"],
  ),
  '`checklist_item.${input.action === "done" ? "completed" : input.action === "skip" ? "skipped" : "reopened"}`':
    combine(["checklist_item"], ["completed", "skipped", "reopened"]),
  "`import.${job.kind}.committed`": [
    "import.employees.committed",
    "import.compensation.committed",
    "import.ytd.committed",
  ],
  "`lifecycle.${input.type}`": combine(
    ["lifecycle"],
    ["transfer", "promotion", "salary_change", "probation_confirmed", "resignation", "termination", "rehire"],
  ),
  '`${labels[kind].one.replace(" ", "_")}.created`': combine(structure, ["created"]),
  '`${labels[kind].one.replace(" ", "_")}.updated`': combine(structure, ["updated"]),
  '`${labels[kind].one.replace(" ", "_")}.${archived ? "archived" : "restored"}`': combine(structure, [
    "archived",
    "restored",
  ]),
};

function auditActions(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return auditActions(path);
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
    const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const actions: string[] = [];
    const inspect = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === "action") {
        const collect = (value: ts.Node) => {
          if (ts.isStringLiteral(value) && /^[a-z_]+\.[a-z_.]+$/.test(value.text)) actions.push(value.text);
          if (ts.isTemplateExpression(value)) {
            const expanded = dynamicActions[value.getText(file)];
            expect(expanded, `Review new audit action template in ${path}: ${value.getText(file)}`).toBeDefined();
            actions.push(...(expanded ?? []));
            return;
          }
          ts.forEachChild(value, collect);
        };
        collect(node.initializer);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(file);
    return actions;
  });
}

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

it("maps every audit action in core to an explicit category, with identical SQL read filters", async () => {
  const actions = [...new Set(auditActions(fileURLToPath(new URL("..", import.meta.url))))];
  expect(actions.length).toBeGreaterThan(150);
  expect(actions).toContain("bank_account.updated");
  const expected = Object.fromEntries(
    actions.map((action) => {
      const category = Object.entries(families).find(([, prefixes]) =>
        prefixes.includes(action.split(".")[0] as string),
      )?.[0];
      expect(category, `Unclassified audit action ${action}`).toBeDefined();
      expect(auditCategory(action), action).toBe(category);
      return [action, category];
    }),
  );
  const deps = createTestDeps(t.db);
  const orgId = (await seedOrg(deps)).id;
  await t.db.transaction(async (tx) => {
    for (const action of actions)
      await recordAudit(tx, deps, systemAuditContext(orgId, "system", "test"), { action, targetType: "test" });
  });
  for (const category of ["security", "payroll", "general"] as const) {
    const filter =
      category === "general"
        ? and(not(auditCategorySql("security")), not(auditCategorySql("payroll")))
        : auditCategorySql(category);
    const rows = await t.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, orgId), filter));
    expect(rows.map((r) => r.action).sort()).toEqual(actions.filter((a) => expected[a] === category).sort());
  }
});
