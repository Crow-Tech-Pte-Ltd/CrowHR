import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedMember, type TestDb } from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { recurringAllowances } from "../db/schema/employees.ts";
import { notifications } from "../db/schema/notifications.ts";
import { createPeopleHarness, hirePayload, seedBasicStructure } from "../testing/people-harness.ts";
import { runFormerTransitions } from "./former.ts";
import { applyEvent, ctxFor, hire } from "./lifecycle.ts";
import { peoplePorts } from "./ports.ts";

/**
 * Security review #6, #7, #16, #17: role holders and pay, through the real HTTP stack and the real
 * ports (identity's memberships, the engine), not the memory doubles.
 */
let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

async function setup() {
  const deps = createTestDeps(t.db);
  const h = await createPeopleHarness(deps);
  delete (h.deps as { people?: unknown }).people;
  const s = await seedBasicStructure(h);
  return { deps, h, s, api: createPeopleTestApp(deps) };
}

describe("#16 recurring allowances are pay", () => {
  it("an hr_admin can't set allowances at hire or in an event; an owner's hire is audited", async () => {
    const { h, s, api } = await setup();
    const owner = api.as(h.orgId, ["owner"]);
    const at = await owner.post("/organisation/allowance-types", { code: "FIXED", name: "Fixed allowance" });
    expect(at.status).toBe(201);
    const hr = api.as(h.orgId, ["hr_admin"]);
    const hired = await hr.post(
      "/employees",
      hirePayload(s, { compensation: null, allowances: [{ allowanceTypeId: at.body.id, amountCents: 1_500_000 }] }),
    );
    expect(hired.status).toBe(403);
    expect(await t.db.select().from(recurringAllowances)).toEqual([]);

    const plain = await hr.post("/employees", hirePayload(s, { compensation: null }));
    expect(plain.status).toBe(201);
    const viaEvent = await hr.post(`/employees/${plain.body.employeeId}/events`, {
      type: "transfer",
      effectiveDate: "2026-12-01",
      changes: { jobTitle: "Lead" },
      allowances: [{ allowanceTypeId: at.body.id, amountCents: 1 }],
    });
    expect(viaEvent.status).toBe(403);

    const byOwner = await owner.post(
      "/employees",
      hirePayload(s, { allowances: [{ allowanceTypeId: at.body.id, amountCents: 20_000 }] }),
    );
    expect(byOwner.status).toBe(201);
    const [hiredEvent] = await t.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "employee.hired"), eq(auditEvents.targetId, byOwner.body.employeeId)));
    expect(hiredEvent?.diff).toMatchObject({ allowances: { changed: true } });
    expect(JSON.stringify(hiredEvent?.diff)).not.toContain("20000");
  });
});

describe("allowance permissions on rehire and scheduled events", () => {
  it("rehiring with allowances requires pay access and scheduled allowance writes reject own pay", async () => {
    const { h, s, api } = await setup();
    const owner = api.as(h.orgId, ["owner"]);
    const at = await owner.post("/organisation/allowance-types", { code: "MEAL", name: "Meal" });
    const hired = await owner.post("/employees", hirePayload(s, { compensation: null }));
    const E = hired.body.employeeId;
    expect(
      (
        await owner.post(`/employees/${E}/events`, {
          type: "termination",
          reason: "dismissal",
          lastWorkingDay: "2026-10-29",
        })
      ).status,
    ).toBe(201);
    const input = {
      type: "rehire",
      job: hirePayload(s).job,
      compensation: null,
      allowances: [{ allowanceTypeId: at.body.id, amountCents: 10_000 }],
    };
    input.job.hireDate = "2026-11-01";
    expect((await api.as(h.orgId, ["hr_admin"]).post(`/employees/${E}/events`, input)).status).toBe(403);
    expect((await api.as(h.orgId, ["owner"], E).post(`/employees/${E}/events`, input)).body.error.code).toBe(
      "self_change_requires_approval",
    );
    const rehired = await owner.post(`/employees/${E}/events`, input);
    expect(rehired.status).toBe(201);
    const [audit] = await t.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetId, E), eq(auditEvents.action, "lifecycle.rehire")));
    expect(audit?.diff).toMatchObject({ allowances: { changed: true } });
    const self = api.as(h.orgId, ["payroll_admin"], E);
    expect(
      (
        await self.post(`/employees/${E}/events`, {
          type: "transfer",
          effectiveDate: "2026-12-01",
          changes: {},
          allowances: input.allowances,
        })
      ).body.error.code,
    ).toBe("self_change_requires_approval");
  });
});

describe("#17 cancelling a scheduled allowance change is a pay change", () => {
  it("an hr_admin can't cancel an allowance-only change on their own record", async () => {
    const { h, s, api } = await setup();
    const owner = api.as(h.orgId, ["owner"]);
    const at = await owner.post("/organisation/allowance-types", { code: "HOUSING", name: "Housing" });
    const hired = await owner.post(
      "/employees",
      hirePayload(s, { allowances: [{ allowanceTypeId: at.body.id, amountCents: 100_000 }] }),
    );
    const E = hired.body.employeeId;
    const ev = await owner.post(`/employees/${E}/events`, {
      type: "transfer",
      effectiveDate: "2026-12-01",
      changes: {},
      allowances: [{ allowanceTypeId: at.body.id, amountCents: 20_000 }],
    });
    expect(ev.status).toBe(201);
    const self = api.as(h.orgId, ["hr_admin"], E);
    const cancel = await self.post(`/employees/${E}/events/${ev.body.eventId}/cancel`);
    expect(cancel.status).toBe(403);
    const rows = await t.db.select().from(recurringAllowances).where(eq(recurringAllowances.employeeId, E));
    expect(rows.map((r) => r.amountCents).sort((x, y) => x - y)).toEqual([20_000, 100_000]);
    // A payroll admin on their own record is refused as a self-change.
    const selfPay = api.as(h.orgId, ["payroll_admin"], E);
    const again = await selfPay.post(`/employees/${E}/events/${ev.body.eventId}/cancel`);
    expect(again.body.error.code).toBe("self_change_requires_approval");
    // Another payroll admin may.
    expect(
      (await api.as(h.orgId, ["payroll_admin"]).post(`/employees/${E}/events/${ev.body.eventId}/cancel`)).status,
    ).toBe(204);
  });
});

it("cancelling a mixed job and allowance event needs both employment and compensation permissions", async () => {
  const { h, s, api } = await setup();
  const owner = api.as(h.orgId, ["owner"]);
  const at = await owner.post("/organisation/allowance-types", { code: "MIXED", name: "Mixed event" });
  const hired = await owner.post("/employees", hirePayload(s, { compensation: null }));
  const E = hired.body.employeeId;
  const event = await owner.post(`/employees/${E}/events`, {
    type: "transfer",
    effectiveDate: "2026-12-01",
    changes: { jobTitle: "Team Lead" },
    allowances: [{ allowanceTypeId: at.body.id, amountCents: 20_000 }],
  });
  expect(event.status).toBe(201);
  const url = `/employees/${E}/events/${event.body.eventId}/cancel`;
  expect((await api.as(h.orgId, ["hr_admin"]).post(url)).status).toBe(403);
  expect((await api.as(h.orgId, ["payroll_admin"]).post(url)).status).toBe(403);
  expect((await owner.post(url)).status).toBe(204);
});

describe("#6 role holders' employment", () => {
  it("a hire never links to a sign-in that holds roles, so an hr_admin can't strip an owner", async () => {
    const { deps, h, s, api } = await setup();
    await seedMember(deps, h.orgId, { email: "boss1@k.sg", roles: ["owner"] });
    const owner2 = await seedMember(deps, h.orgId, { email: "boss2@k.sg", roles: ["owner"] });
    const hr = api.as(h.orgId, ["hr_admin"]);
    const hired = await hr.post(
      "/employees",
      hirePayload(s, { person: { workEmail: "boss2@k.sg" }, compensation: null }),
    );
    expect(hired.status).toBe(201);
    expect(hired.body.invite.status).toBe("skipped");
    const [m] = await t.db.select().from(memberships).where(eq(memberships.id, owner2.membershipId));
    expect(m?.employeeId).toBeNull();
    // A plain member is still linked.
    await seedMember(deps, h.orgId, { email: "staff@k.sg", roles: [] });
    const plain = await hr.post(
      "/employees",
      hirePayload(s, { person: { workEmail: "staff@k.sg" }, compensation: null }),
    );
    expect(plain.body.invite.status).toBe("linked");
  });

  it("only an owner may record the leaving of someone who holds roles", async () => {
    const { deps, h, s, api } = await setup();
    const owner = api.as(h.orgId, ["owner"]);
    const hired = await owner.post("/employees", hirePayload(s, { compensation: null }));
    const E = hired.body.employeeId;
    const admin = await seedMember(deps, h.orgId, { email: "pay@k.sg", roles: ["payroll_admin"], employeeId: E });
    const hr = api.as(h.orgId, ["hr_admin"]);
    const ended = await hr.post(`/employees/${E}/events`, {
      type: "termination",
      reason: "dismissal",
      lastWorkingDay: "2026-10-30",
    });
    expect(ended.status).toBe(403);
    expect(ended.body.error.details.reason).toBe("holds_roles");
    expect(
      await t.db.select().from(membershipRoles).where(eq(membershipRoles.membershipId, admin.membershipId)),
    ).toHaveLength(1);
    const byOwner = await owner.post(`/employees/${E}/events`, {
      type: "termination",
      reason: "dismissal",
      lastWorkingDay: "2026-10-30",
    });
    expect(byOwner.status).toBe(201);
  });
});

describe("#7 the former-member sweep", () => {
  it("refuses a leaving event for the last active owner", async () => {
    const { deps, h, s } = await setup();
    // Service level: the actor's owner role comes from the harness, not from a membership, so the
    // leaver's sign-in is the only active owner of the organisation.
    const ports = peoplePorts(deps);
    const actor = h.actor(["owner"]);
    const { employeeId } = await hire(ctxFor(deps, ports, actor), hirePayload(s, { compensation: null }));
    await seedMember(deps, h.orgId, { email: "sole@k.sg", roles: ["owner"], employeeId });
    await expect(
      applyEvent(ctxFor(deps, ports, actor), employeeId, {
        type: "termination",
        reason: "dismissal",
        lastWorkingDay: "2026-10-30",
      }),
    ).rejects.toMatchObject({ code: "last_owner" });
    await seedMember(deps, h.orgId, { email: "next@k.sg", roles: ["owner"] });
    await expect(
      applyEvent(ctxFor(deps, ports, actor), employeeId, {
        type: "termination",
        reason: "dismissal",
        lastWorkingDay: "2026-10-30",
      }),
    ).resolves.toMatchObject({ status: "effective" });
  });

  it("an org-scoped sweep cannot change another organisation's memberships or tenures", async () => {
    const { deps, h, s } = await setup();
    const other = await createPeopleHarness(deps, { orgName: "Other Org" });
    const otherStructure = await seedBasicStructure(other);
    delete (deps as { people?: unknown }).people;
    const people = [];
    for (const [harness, structure] of [
      [h, s],
      [other, otherStructure],
    ] as const) {
      const ports = peoplePorts(deps);
      const ctx = ctxFor(deps, ports, harness.actor(["owner"]));
      const { employeeId } = await hire(ctx, hirePayload(structure, { compensation: null }));
      const member = await seedMember(deps, harness.orgId, { employeeId, roles: [] });
      await applyEvent(ctx, employeeId, { type: "termination", reason: "dismissal", lastWorkingDay: "2026-10-29" });
      people.push(member);
    }
    expect(await runFormerTransitions(deps, peoplePorts(deps).memberships, deps.clock.now(), { orgId: h.orgId })).toBe(
      1,
    );
    const [unchanged] = await t.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, people[1]?.membershipId as string));
    expect(unchanged?.status).toBe("active");
    expect(
      await runFormerTransitions(deps, peoplePorts(deps).memberships, deps.clock.now(), { orgId: other.orgId }),
    ).toBe(1);
    expect(await runFormerTransitions(deps, peoplePorts(deps).memberships)).toBe(0);
  });

  // Two owner sign-ins linked to one employee record are impossible since
  // memberships_org_employee_live_unique, so only the single-owner case remains.
  it.each([1])(
    "one failing tenure never blocks others; alerts once per owner (%i linked owners)",
    async (ownerCount) => {
      const { deps, h, s, api } = await setup();
      const owner = api.as(h.orgId, ["owner"]);
      const a = await owner.post("/employees", hirePayload(s, { compensation: null }));
      const b = await owner.post("/employees", hirePayload(s, { compensation: null }));
      // Leaver A's sign-in is an owner; their termination was recorded while another owner existed.
      const ownerA = await seedMember(deps, h.orgId, {
        email: "a@k.sg",
        roles: ["owner"],
        employeeId: a.body.employeeId,
      });
      const staffB = await seedMember(deps, h.orgId, { email: "b@k.sg", roles: [], employeeId: b.body.employeeId });
      for (const id of [a.body.employeeId, b.body.employeeId]) {
        const ev = await owner.post(`/employees/${id}/events`, {
          type: "termination",
          reason: "dismissal",
          lastWorkingDay: "2026-10-29",
        });
        expect(ev.status).toBe(201);
      }
      // Every other owner has since left: A is the last active owner, so A can't be made former.
      await t.db
        .delete(membershipRoles)
        .where(and(eq(membershipRoles.orgId, h.orgId), eq(membershipRoles.role, "owner")));
      await t.db.insert(membershipRoles).values({ orgId: h.orgId, membershipId: ownerA.membershipId, role: "owner" });
      const owners = [ownerA];
      if (ownerCount === 2) owners.push(await seedMember(deps, h.orgId, { email: "a2@k.sg", roles: ["owner"] }));

      for (let i = 0; i < 3; i++) await runFormerTransitions(deps, peoplePorts(deps).memberships);
      const [mb] = await t.db.select().from(memberships).where(eq(memberships.id, staffB.membershipId));
      expect(mb?.status).toBe("former");
      const [ma] = await t.db.select().from(memberships).where(eq(memberships.id, ownerA.membershipId));
      expect(ma?.status).toBe("active");
      const alerts = await t.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.orgId, h.orgId), eq(notifications.subjectType, "former_transition")));
      expect(alerts).toHaveLength(ownerCount);
      expect(alerts.map((a) => a.recipientMembershipId).sort()).toEqual(owners.map((o) => o.membershipId).sort());
      const activeOwners = await t.db.select().from(memberships).where(eq(memberships.employeeId, a.body.employeeId));
      expect(activeOwners.every((m) => m.status === "active")).toBe(true);
    },
  );
});
