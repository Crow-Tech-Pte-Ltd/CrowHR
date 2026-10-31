import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  foreignIds,
  seedMember,
  seedOrg,
  sweepCrossOrg,
  type TestDb,
} from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { verifyChain } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import type { AppDeps } from "../deps.ts";
import { organisationModule } from "../organisation/routes.ts";
import { createPeopleHarness, OWNER, type PeopleHarness } from "../testing/people-harness.ts";
import { type SeededPeople, seedPeople } from "../testing/seed-people.ts";
import { runFormerTransitions } from "./former.ts";
import { applyEvent, ctxFor } from "./lifecycle.ts";
import { defaultPeoplePorts, type PeoplePorts } from "./ports.ts";
import { employeesModule, peopleModule } from "./routes.ts";

// One seeded database for the whole file: seeding 24 employees is the slow part, and the tests
// below only add to it (a salary change, a termination) without depending on each other's rows.
let t: TestDb;
let deps: AppDeps;
let h: PeopleHarness;
let ports: PeoplePorts;
let seeded: SeededPeople;
let api: ReturnType<typeof createPeopleTestApp>;

beforeAll(async () => {
  t = await createTestDb();
  deps = createTestDeps(t.db);
  h = await createPeopleHarness(deps);
  // Drop the doubles: the app falls back to deps.secretBox, recordAudit() and markMembershipFormer().
  delete (h.deps as { people?: unknown }).people;
  ports = defaultPeoplePorts(deps);
  seeded = await seedPeople(deps, ports, h.actor(OWNER));
  api = createPeopleTestApp(deps);
});
afterAll(() => t.close());

describe("with identity's real services (no test doubles)", () => {
  it("records hash-chained audit events with sensitive values hidden", async () => {
    const pay = api.as(h.orgId, ["payroll_admin"]);
    const res = await pay.post(`/employees/${seeded.employees.fin}/events`, {
      type: "salary_change",
      effectiveDate: "2027-03-01",
      compensation: { payBasis: "monthly", amountCents: 377_700 },
    });
    expect(res.status).toBe(201);
    const events = await t.db.select().from(auditEvents).where(eq(auditEvents.orgId, h.orgId));
    const salary = events.find(
      (e) =>
        e.action === "lifecycle.salary_change" &&
        (e.meta as { effectiveDate?: string })?.effectiveDate === "2027-03-01",
    );
    expect(salary?.actorType).toBe("member");
    expect(salary?.diff).toMatchObject({ basicPayCents: { changed: true } });
    expect(JSON.stringify(events)).not.toContain("377700");
    expect(await verifyChain(t.db, h.orgId)).toMatchObject({ ok: true });
  });

  it("the former transition drops the linked membership's roles", async () => {
    const leaver = seeded.employees.barista2 as string;
    const member = await seedMember(deps, h.orgId, { roles: ["hr_admin"], employeeId: leaver });
    await applyEvent(ctxFor(deps, ports, h.actor(OWNER)), leaver, {
      type: "termination",
      reason: "mutual_agreement",
      lastWorkingDay: "2026-11-30",
    });
    // The seed also has a leaver in notice and an earlier former employee.
    expect(await runFormerTransitions(deps, ports.memberships, new Date("2026-12-01T01:00:00Z"))).toBe(3);
    const [m] = await t.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, h.orgId), eq(memberships.id, member.membershipId)));
    expect(m?.status).toBe("former");
  });

  it("every people route answers 404 for another organisation's records", async () => {
    // The seeded organisation is B; A is an empty organisation whose owner goes looking.
    const orgA = await seedOrg(deps, { name: "A Pte. Ltd." });
    const ownerOfA = await clientAs(api.app, deps, await seedMember(deps, orgA.id, { roles: ["owner"] }));
    // One ID from every tenant table covers each kind of record: a route that leaks one row of a table leaks them all.
    const ids = await foreignIds(t.db, h.orgId, { perTable: 1 });
    expect(ids.length).toBeGreaterThan(20);
    const result = await sweepCrossOrg({
      app: api.app,
      ownerOfA,
      idsOfB: ids,
      modules: [employeesModule, organisationModule, peopleModule],
    });
    expect(result.untestable).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.checked.length).toBeGreaterThan(15);
  });
});
