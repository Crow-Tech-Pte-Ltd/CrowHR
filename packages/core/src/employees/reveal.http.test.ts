import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientAs, createTestDb, createTestDeps, seedMember, type TestDb } from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { auditEvents } from "../db/schema/audit.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { ctxFor, hire } from "./lifecycle.ts";
import { setBankAccount } from "./profile.ts";

let t: TestDb;
let h: PeopleHarness;
let api: ReturnType<typeof createPeopleTestApp>;
let employeeId: string;
let s: BasicStructure;

beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
  s = await seedBasicStructure(h);
  employeeId = (
    await hire(ctxFor(h.deps, h.ports, h.actor(OWNER)), hirePayload(s, { person: { idNumber: "S1234567D" } }))
  ).employeeId;
  await setBankAccount(h.deps, h.ports, h.actor(OWNER), employeeId, {
    bankCode: "OCBCSGSG",
    accountNumber: "501-234567-8",
    holderName: "Tan Mei Ling",
    effectiveFrom: "2026-01-05",
  });
  api = createPeopleTestApp(h.deps);
});
afterEach(() => t.close());

describe("NRIC and bank reveal", () => {
  it("returns the full value once, uncached, and audits it", async () => {
    const pay = api.as(h.orgId, ["payroll_admin"]);
    const nric = await pay.post(`/employees/${employeeId}/nric/reveal`);
    expect(nric.status).toBe(200);
    expect(nric.body).toEqual({ value: "S1234567D" });
    expect(nric.headers.get("cache-control")).toBe("no-store");
    const bank = await pay.post(`/employees/${employeeId}/bank/reveal`);
    expect(bank.body).toEqual({ value: "5012345678" });
    const events = await t.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, h.orgId), eq(auditEvents.targetId, employeeId)));
    expect(events.map((e) => e.action).sort()).toEqual(["bank.revealed", "nric.revealed"]);
    expect(JSON.stringify(events)).not.toContain("S1234567D");
  });

  it("requires a sign-in within the last 10 minutes", async () => {
    const m = await seedMember(h.deps, h.orgId, { roles: ["hr_admin"] });
    const stale = await clientAs(api.app, h.deps, m, { authenticatedAt: new Date("2026-10-31T00:00:00Z") });
    const res = await stale.post(`/api/v1/employees/${employeeId}/nric/reveal`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("reauth_required");
  });

  it("hr_admin cannot reveal bank numbers; managers and colleagues cannot reveal NRIC; other orgs get 404", async () => {
    expect((await api.as(h.orgId, ["hr_admin"]).post(`/employees/${employeeId}/bank/reveal`)).status).toBe(403);
    const colleague = (await hire(ctxFor(h.deps, h.ports, h.actor(OWNER)), hirePayload(s))).employeeId;
    expect((await api.as(h.orgId, [], colleague).post(`/employees/${employeeId}/nric/reveal`)).status).toBe(404);
    const own = await api.as(h.orgId, [], employeeId).post(`/employees/${employeeId}/nric/reveal`);
    expect(own.body).toEqual({ value: "S1234567D" });
    const other = await createPeopleHarness(h.deps, { orgName: "Other Pte. Ltd." });
    expect((await api.as(other.orgId, ["owner"]).post(`/employees/${employeeId}/nric/reveal`)).status).toBe(404);
  });
});
