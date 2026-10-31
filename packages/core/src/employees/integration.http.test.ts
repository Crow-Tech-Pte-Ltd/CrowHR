import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  foreignIds,
  seedMember,
  sweepCrossOrg,
  type TestDb,
} from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { verifyChain } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { organisationModule } from "../organisation/routes.ts";
import { createPeopleHarness, OWNER } from "../testing/people-harness.ts";
import { seedPeople } from "../testing/seed-people.ts";
import { runFormerTransitions } from "./former.ts";
import { applyEvent, ctxFor } from "./lifecycle.ts";
import { defaultPeoplePorts } from "./ports.ts";
import { employeesModule, peopleModule } from "./routes.ts";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

describe("with identity's real services (no test doubles)", () => {
  it("records hash-chained audit events with sensitive values hidden", async () => {
    const deps = createTestDeps(t.db);
    const h = await createPeopleHarness(deps);
    // Drop the doubles: the app falls back to deps.secretBox, recordAudit() and markMembershipFormer().
    delete (h.deps as { people?: unknown }).people;
    const ports = defaultPeoplePorts(deps);
    const seeded = await seedPeople(deps, ports, h.actor(OWNER));
    const api = createPeopleTestApp(deps);
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
    const deps = createTestDeps(t.db);
    const h = await createPeopleHarness(deps);
    delete (h.deps as { people?: unknown }).people;
    const ports = defaultPeoplePorts(deps);
    const seeded = await seedPeople(deps, ports, h.actor(OWNER));
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
    const deps = createTestDeps(t.db);
    const hA = await createPeopleHarness(deps, { orgName: "A Pte. Ltd." });
    const hB = await createPeopleHarness(deps, { orgName: "B Pte. Ltd." });
    await seedPeople(deps, hB.ports, hB.actor(OWNER));
    const api = createPeopleTestApp(deps);
    const ownerOfA = await clientAs(api.app, deps, await seedMember(deps, hA.orgId, { roles: ["owner"] }));
    const ids = await foreignIds(t.db, hB.orgId);
    expect(ids.length).toBeGreaterThan(50);
    const result = await sweepCrossOrg({
      app: api.app,
      ownerOfA,
      idsOfB: ids.slice(0, 60),
      modules: [employeesModule, organisationModule, peopleModule],
    });
    expect(result.untestable).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.checked.length).toBeGreaterThan(15);
  });
});
