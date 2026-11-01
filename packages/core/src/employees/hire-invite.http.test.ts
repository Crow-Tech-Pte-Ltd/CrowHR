import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestDeps,
  seedEmployee,
  seedMember,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { memberships } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import type { AppDeps, Mailer } from "../deps.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";

/** People task 4.1: hiring someone with a work email invites them through identity's invite service. */

let t: TestDb;
let h: PeopleHarness;
let s: BasicStructure;
const PASSWORD = "correct horse battery staple";

async function setup(overrides: Partial<AppDeps> = {}) {
  const deps = createTestDeps(t.db, overrides);
  h = await createPeopleHarness(deps);
  delete (h.deps as { people?: unknown }).people; // real ports: inviteMember(), recordAudit()
  s = await seedBasicStructure(h);
  return { deps, api: createPeopleTestApp(deps) };
}

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

describe("hire-time invitation", () => {
  it("without SMTP returns a one-time link; accepting it signs the employee in to their own record", async () => {
    const { deps, api } = await setup();
    const res = await api
      .as(h.orgId, ["hr_admin"])
      .post("/employees", hirePayload(s, { person: { workEmail: "Mei.Ling@KopiKaki.sg" }, compensation: null }));
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({ status: "link", inviteUrl: expect.stringContaining("/invite/") });
    const [m] = await t.db.select().from(memberships).where(eq(memberships.employeeId, res.body.employeeId));
    expect(m).toMatchObject({ orgId: h.orgId, status: "invited" });
    const events = await t.db.select().from(auditEvents).where(eq(auditEvents.orgId, h.orgId));
    expect(events.find((e) => e.action === "member.invited")?.meta).toMatchObject({
      email: "mei.ling@kopikaki.sg",
      roles: [],
      employeeId: res.body.employeeId,
    });

    const token = String(res.body.invite.inviteUrl).split("/invite/")[1];
    const anon = testClient(api.app, deps);
    expect((await anon.post("/api/v1/auth/invitations/accept", { token, password: PASSWORD })).status).toBe(200);
    const me = (await (await anon.get("/api/v1/me")).json()) as { employeeId: string | null };
    expect(me.employeeId).toBe(res.body.employeeId);
    expect((await anon.get("/api/v1/people/me/profile")).status).toBe(200);
  });

  it("emails the invitation when a mailer is configured", async () => {
    const sent: { to: string; text: string }[] = [];
    const mailer: Mailer = { send: async (m) => void sent.push(m) };
    const { api } = await setup({ mailer });
    const res = await api
      .as(h.orgId, ["owner"])
      .post("/employees", hirePayload(s, { person: { workEmail: "ali@kopikaki.sg" } }));
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({ status: "emailed", inviteUrl: null });
    expect(sent.map((m) => m.to)).toEqual(["ali@kopikaki.sg"]);
    expect(sent[0]?.text).toContain("/invite/");
  });

  it("links an existing member without an employee record instead of failing the hire", async () => {
    const { deps, api } = await setup();
    const existing = await seedMember(deps, h.orgId, { email: "staff@kopikaki.sg", roles: [] });
    const res = await api
      .as(h.orgId, ["hr_admin"])
      .post("/employees", hirePayload(s, { person: { workEmail: "staff@kopikaki.sg" }, compensation: null }));
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({ status: "linked", inviteUrl: null });
    const [m] = await t.db.select().from(memberships).where(eq(memberships.id, existing.membershipId));
    expect(m?.employeeId).toBe(res.body.employeeId);

    // Work emails are unique among current employees, so nobody else can take over that link.
    const again = await api
      .as(h.orgId, ["hr_admin"])
      .post("/employees", hirePayload(s, { person: { workEmail: "staff@kopikaki.sg" }, compensation: null }));
    expect(again.status).toBe(409);
  });

  it("skips the invitation when asked to, or without a work email", async () => {
    const { api } = await setup();
    const hr = api.as(h.orgId, ["hr_admin"]);
    const none = await hr.post("/employees", hirePayload(s, { compensation: null }));
    expect(none.body.invite).toBeNull();
    const off = await hr.post(
      "/employees",
      hirePayload(s, { person: { workEmail: "later@kopikaki.sg" }, invite: false, compensation: null }),
    );
    expect(off.status).toBe(201);
    expect(off.body.invite).toBeNull();
  });

  it("a membership can only link an employee of its own organisation", async () => {
    const { deps, api } = await setup();
    const other = await createPeopleHarness(deps, { orgName: "Other Pte. Ltd." });
    const theirs = await seedEmployee(deps, other.orgId);
    const res = await api
      .as(h.orgId, ["owner"])
      .post("/members/invitations", { email: "x@kopikaki.sg", displayName: "X", employeeId: theirs });
    expect(res.status).toBe(404);
    // And the database itself refuses it (composite FK memberships(org_id, employee_id)).
    const owner = await seedMember(deps, h.orgId, { roles: ["owner"] });
    await expect(
      t.db.update(memberships).set({ employeeId: theirs }).where(eq(memberships.id, owner.membershipId)),
    ).rejects.toThrow();
  });
});
