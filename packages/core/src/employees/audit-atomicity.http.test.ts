import { and, eq, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import { createPeopleTestApp, type PeopleClient } from "../../testing/people-http.ts";
import * as employeeTables from "../db/schema/employees.ts";
import * as organisationTables from "../db/schema/organisation.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import type { AppDeps } from "../deps.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { ctxFor, hire } from "./lifecycle.ts";
import { defaultPeoplePorts } from "./ports.ts";

/**
 * Architecture "Write + audit in one transaction": every people and
 * organisation write records its audit event inside the transaction that makes
 * the change, so a failed audit insert leaves no change behind. A trigger
 * makes the audit insert fail on demand; each route must then answer 500 and
 * leave every people table exactly as it was, and succeed once the trigger is
 * off (so the case is not vacuous).
 */

let t: TestDb;
let deps: AppDeps;
let h: PeopleHarness;
let api: ReturnType<typeof createPeopleTestApp>;
let owner: PeopleClient;
let payroll: PeopleClient;
let employee: PeopleClient;
let employeeId: string;
let departmentId: string;
let structure: BasicStructure;

const PEOPLE_TABLES = ([...Object.values(employeeTables), ...Object.values(organisationTables)] as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map((table) => getTableName(table));

async function fingerprint(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of [...PEOPLE_TABLES, "audit_events", "organisations"]) {
    const res = await t.pglite.query<{ h: string }>(
      `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${name}" x`,
    );
    out[name] = String(res.rows[0]?.h);
  }
  return out;
}

async function failAudit(on: boolean) {
  await t.pglite.query(`update test_fail_audit set fail = ${on}`);
}

beforeAll(async () => {
  t = await createTestDb();
  deps = createTestDeps(t.db);
  h = await createPeopleHarness(deps);
  // Identity's real services: recordAudit() into the hash-chained log, not the memory double.
  delete (h.deps as { people?: unknown }).people;
  structure = await seedBasicStructure(h);
  departmentId = structure.departments.sales;
  const ports = defaultPeoplePorts(deps);
  ({ employeeId } = await hire(ctxFor(deps, ports, h.actor(OWNER)), hirePayload(structure)));
  api = createPeopleTestApp(deps);
  owner = api.as(h.orgId, ["owner"]);
  payroll = api.as(h.orgId, ["payroll_admin"]);
  employee = api.as(h.orgId, [], employeeId);
  await t.pglite.exec(`
    create table test_fail_audit (fail boolean not null);
    insert into test_fail_audit values (false);
    create function test_fail_audit() returns trigger language plpgsql as $$
    begin
      if (select fail from test_fail_audit limit 1) then raise exception 'audit insert failed (test)'; end if;
      return new;
    end $$;
    create trigger test_fail_audit before insert on audit_events for each row execute function test_fail_audit();
  `);
  // Sign everyone in before the trigger is armed (sign-in itself is audited).
  await Promise.all([
    owner.get("/organisation/profile"),
    payroll.get("/organisation/profile"),
    employee.get("/people/me/profile"),
  ]);
});
afterAll(() => t.close());

const today = "2026-11-02";

const cases: { name: string; call: () => Promise<{ status: number }> }[] = [
  { name: "create department", call: () => owner.post("/organisation/structure/departments", { name: "Marketing" }) },
  {
    name: "rename department",
    call: () => owner.patch(`/organisation/structure/departments/${departmentId}`, { name: "Sales SG" }),
  },
  {
    name: "archive department",
    call: () =>
      owner.post(`/organisation/structure/departments/${structure.departments.finance}/archive`, { archived: true }),
  },
  {
    name: "company profile",
    call: () =>
      owner.put("/organisation/profile", { legalName: "Kopi Kaki Pte. Ltd.", uen: "201912345K", postalCode: "082001" }),
  },
  {
    name: "work schedule",
    call: () => owner.post("/organisation/work-schedules", { name: "Shift 44h", kind: "shift", weeklyMinutes: 2640 }),
  },
  { name: "allowance type", call: () => payroll.post("/organisation/allowance-types", { code: "MEAL", name: "Meal" }) },
  {
    name: "checklist template",
    call: () =>
      owner.post("/organisation/checklist-templates", {
        kind: "onboarding",
        name: "Kitchen onboarding",
        items: [{ title: "Food hygiene course", assigneeRole: "hr_admin", dueOffsetDays: 7 }],
      }),
  },
  { name: "update personal details", call: () => owner.patch(`/employees/${employeeId}`, { preferredName: "Mei" }) },
  {
    name: "emergency contacts",
    call: () =>
      owner.put(`/employees/${employeeId}/emergency-contacts`, {
        contacts: [{ name: "Tan Ah Kow", relationship: "Father", phone: "91234567" }],
      }),
  },
  {
    name: "lifecycle event",
    call: () =>
      owner.post(`/employees/${employeeId}/events`, {
        type: "transfer",
        effectiveDate: "2026-12-01",
        changes: { jobTitle: "Senior Account Executive" },
      }),
  },
  {
    name: "salary change",
    call: () =>
      payroll.post(`/employees/${employeeId}/events`, {
        type: "salary_change",
        effectiveDate: "2027-01-01",
        compensation: { payBasis: "monthly", amountCents: 450_000 },
      }),
  },
  {
    name: "bank account",
    call: () =>
      payroll.post(`/employees/${employeeId}/bank-accounts`, {
        bankCode: "DBSSSGSG",
        accountNumber: "0123456789",
        holderName: "Tan Mei Ling",
        effectiveFrom: today,
      }),
  },
  {
    name: "work pass",
    call: () =>
      owner.post(`/employees/${employeeId}/work-passes`, {
        passType: "S_PASS",
        passNumber: "G1234567X",
        issuedOn: "2026-01-02",
        expiresOn: "2028-01-01",
      }),
  },
  { name: "hire", call: () => owner.post("/employees", hirePayload(structure)) },
  { name: "self-service profile", call: () => employee.patch("/people/me/profile", { mobile: "8888 1234" }) },
  {
    name: "change request",
    call: () => employee.post("/people/me/change-requests", { personal: { religion: "christianity" } }),
  },
];

describe("a failed audit write rolls the change back", () => {
  for (const c of cases) {
    it(c.name, async () => {
      const before = await fingerprint();
      await failAudit(true);
      try {
        expect((await c.call()).status).toBe(500);
      } finally {
        await failAudit(false);
      }
      expect(await fingerprint()).toEqual(before);
      const ok = await c.call();
      expect(ok.status, `${c.name} should succeed once audit writes work`).toBeLessThan(300);
      expect(await fingerprint()).not.toEqual(before);
    });
  }

  it("deciding a change request", async () => {
    const sub = await employee.post("/people/me/change-requests", {
      bank: { bankCode: "OCBCSGSG", accountNumber: "5012345678", holderName: "Tan Mei Ling" },
    });
    expect(sub.status).toBe(201);
    const id = sub.body.items[0].id as string;
    const [task] = await deps.db
      .select({ id: approvalTasks.id })
      .from(approvalTasks)
      .innerJoin(
        approvalRequests,
        and(eq(approvalRequests.id, approvalTasks.requestId), eq(approvalRequests.orgId, approvalTasks.orgId)),
      )
      .where(
        and(
          eq(approvalRequests.orgId, h.orgId),
          eq(approvalRequests.subjectId, id),
          eq(approvalTasks.status, "pending"),
        ),
      );
    expect(task).toBeDefined();
    const decide = () => payroll.post(`/approvals/tasks/${task?.id}/decision`, { decision: "approve" });
    const before = await fingerprint();
    await failAudit(true);
    try {
      expect((await decide()).status).toBe(500);
    } finally {
      await failAudit(false);
    }
    // Neither the new bank account nor the decision survived.
    expect(await fingerprint()).toEqual(before);
    expect((await decide()).status).toBe(200);
  });
});
