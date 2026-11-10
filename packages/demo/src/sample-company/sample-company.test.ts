import { createApp, createMemoryFileStore, type Db, fixedClock, schema, verifyChain } from "@crowhr/core";
import {
  createTestDb,
  createTestDeps,
  fakePasswordHasher,
  seedMember,
  seedOrg,
  TEST_PUBLIC_URL,
  TEST_SECRET_KEY,
  type TestDb,
  testClient,
} from "@crowhr/core/testing";
import { eq, getTableColumns, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../personas.ts";
import { OrganisationCopyRefused } from "./copy-organisation.ts";
import {
  assertCanInstall,
  installSampleCompany,
  type PreparedSampleCompany,
  prepareSampleCompany,
  SAMPLE_ORG,
} from "./seed.ts";

/**
 * The sample company for a real server (scripts/seed-sample-company.ts): seeded in a scratch
 * database, brought up to "today", then copied into a server database that already hosts
 * another organisation. The other organisation must be byte-for-byte untouched, the copy must
 * refuse to run twice, and the reviewer accounts must work through normal password sign-in.
 */
const NOW = new Date("2026-11-10T02:00:00.000Z"); // Tue 10 Nov 2026, 10:00 Singapore

/** Every row of every tenant table belonging to `orgId`, plus its users, as comparable JSON. */
async function orgSnapshot(db: Db, orgId: string) {
  const out: Record<string, unknown[]> = {};
  const userIds = (
    await db
      .select({ u: schema.memberships.userId })
      .from(schema.memberships)
      .where(eq(schema.memberships.orgId, orgId))
  ).map((r) => r.u);
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const name = getTableConfig(value).name;
    const cols = getTableColumns(value);
    let rows: Record<string, unknown>[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: any table's columns.
    const col = (k: string) => cols[k] as any;
    if (name === "organisations")
      rows = await db
        .select()
        .from(value)
        .where(eq(col("id"), orgId));
    else if (cols.orgId)
      rows = await db
        .select()
        .from(value)
        .where(eq(col("orgId"), orgId));
    else if (name === "users") rows = (await db.select().from(value)).filter((u) => userIds.includes(String(u.id)));
    else continue;
    out[name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

describe("sample company seed for a real server", () => {
  let scratch: TestDb;
  let target: TestDb;
  let other: { id: string; slug: string };
  let otherBefore: Awaited<ReturnType<typeof orgSnapshot>>;
  let prepared: PreparedSampleCompany;
  const files = createMemoryFileStore();
  const progress: string[] = [];

  beforeAll(async () => {
    scratch = await createTestDb();
    target = await createTestDb();
    // The server's first organisation, as after the setup wizard: an owner who signs in.
    const deps = createTestDeps(target.db, { clock: fixedClock(NOW) });
    other = await seedOrg(deps, { name: "Crow HR Staging", slug: "crow-hr-staging" });
    await seedMember(deps, other.id, {
      email: "owner@staging.example",
      password: "staging-owner-pw",
      roles: ["owner"],
    });
    otherBefore = await orgSnapshot(target.db, other.id);

    prepared = await prepareSampleCompany({
      scratch: scratch.db,
      secretKey: TEST_SECRET_KEY,
      passwordHasher: fakePasswordHasher,
      publicUrl: TEST_PUBLIC_URL,
      now: NOW,
      progress: (m) => progress.push(m),
    });
  }, 900_000);
  afterAll(async () => {
    await scratch?.close();
    await target?.close();
  });

  it("brings the company up to today and checks what reviewers need", () => {
    expect(progress.length).toBeGreaterThan(3);
    const c = prepared.checks;
    expect(c.today).toBe("2026-11-10");
    expect(c.employeePayslips).toBeGreaterThanOrEqual(4); // July to October, all released
    expect(c.employeeLeaveTypes).toBeGreaterThan(0);
    expect(c.rosterWeeks).toHaveLength(9);
    expect(c.rosterWeeks[0]?.weekStart).toBe("2026-11-09");
    for (const w of c.rosterWeeks) expect(w.shifts, w.weekStart).toBeGreaterThan(0);
    expect(c.managerPendingTasks).toBeGreaterThanOrEqual(3);
    expect(c.ssoProviders).toBe(0);
    expect(c.attendanceLocationMode).toBe("off");
  });

  it("gives every account its own new password and names the reviewer pair", () => {
    const { accounts } = prepared;
    expect(accounts).toHaveLength(13);
    const passwords = new Set(accounts.map((a) => a.password));
    expect(passwords.size).toBe(13);
    expect(passwords.has(DEMO_PASSWORD)).toBe(false);
    for (const a of accounts) expect(a.password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(
      accounts
        .filter((a) => a.reviewer)
        .map((a) => [a.reviewer, a.email])
        .sort(),
    ).toEqual([
      ["employee", "hafiz@kopikaki.example"],
      ["manager", "siti@kopikaki.example"],
    ]);
  });

  it("copies the company into the server without touching the other organisation", async () => {
    const result = await installSampleCompany(prepared, target.db, files);
    expect(result.copy.total).toBeGreaterThan(1000);
    expect(result.files).toBe(prepared.files.size);
    expect(result.files).toBeGreaterThan(0);
    for (const key of prepared.files.keys()) expect(await files.get(key)).not.toBeNull();

    expect(await orgSnapshot(target.db, other.id)).toEqual(otherBefore);
    const orgs = await target.db.select().from(schema.organisations);
    expect(orgs.map((o) => o.slug).sort()).toEqual(["crow-hr-staging", "kopi-kaki"]);
    // Copied rows are identical to the scratch database's, and both audit chains are intact.
    expect(await orgSnapshot(target.db, prepared.orgId)).toEqual(await orgSnapshot(scratch.db, prepared.orgId));
    expect((await verifyChain(target.db, prepared.orgId)).ok).toBe(true);
    expect((await verifyChain(target.db, other.id)).ok).toBe(true);
  });

  it("refuses to run again, and refuses when one of its emails is taken", async () => {
    await expect(assertCanInstall(target.db)).rejects.toBeInstanceOf(OrganisationCopyRefused);
    await expect(installSampleCompany(prepared, target.db, files)).rejects.toThrow(/already exists/);
    expect(await orgSnapshot(target.db, other.id)).toEqual(otherBefore);

    const fresh = await createTestDb();
    try {
      const deps = createTestDeps(fresh.db);
      const org = await seedOrg(deps, { slug: "someone-else" });
      await seedMember(deps, org.id, { email: "JunJie@kopikaki.example", roles: ["owner"] });
      await expect(assertCanInstall(fresh.db)).rejects.toThrow(/already belong to users/);
      await expect(installSampleCompany(prepared, fresh.db, createMemoryFileStore())).rejects.toBeInstanceOf(
        OrganisationCopyRefused,
      );
      expect(await fresh.db.select().from(schema.organisations)).toHaveLength(1);
    } finally {
      await fresh.close();
    }
  });

  it("lets the reviewer accounts sign in with password on the real (non-demo) server", async () => {
    const deps = createTestDeps(target.db, { clock: fixedClock(NOW), fileStore: files });
    const app = createApp(deps);
    const account = (role: "employee" | "manager") => prepared.accounts.find((a) => a.reviewer === role);

    const methods = await (await app.request(`${TEST_PUBLIC_URL}/api/v1/meta?org=${SAMPLE_ORG.slug}`)).json();
    expect(JSON.stringify(methods)).not.toMatch(/google|entra|singpass/i);

    const demoPassword = testClient(app, deps);
    const refused = await demoPassword.post("/api/v1/auth/sign-in", {
      org: SAMPLE_ORG.slug,
      email: account("employee")?.email,
      password: DEMO_PASSWORD,
    });
    expect(refused.status).toBe(401);
    expect((await demoPassword.post("/api/v1/auth/demo/sign-in", { membershipId: prepared.orgId })).status).toBe(404);

    const employee = testClient(app, deps);
    const signIn = await employee.post("/api/v1/auth/sign-in", {
      org: SAMPLE_ORG.slug,
      email: account("employee")?.email,
      password: account("employee")?.password,
    });
    expect(signIn.status).toBe(200);
    expect((await signIn.json()).mfaRequired).toBe(false);
    const payslips = await (await employee.get("/api/v1/payslips")).json();
    expect(payslips.items.length).toBeGreaterThanOrEqual(4);
    const pdf = await employee.get(`/api/v1/payslips/${payslips.items[0].id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    const receipt = (await target.db.select().from(schema.files).where(eq(schema.files.orgId, prepared.orgId)))[0];
    expect(receipt && (await files.get(receipt.storageKey))).toBeTruthy();

    const manager = testClient(app, deps);
    expect(
      (
        await manager.post("/api/v1/auth/sign-in", {
          org: SAMPLE_ORG.slug,
          email: account("manager")?.email,
          password: account("manager")?.password,
        })
      ).status,
    ).toBe(200);
    const tasks = await (await manager.get("/api/v1/approvals/tasks")).json();
    const names = tasks.items.map((t: { requester: { name: string } }) => t.requester.name);
    expect(names.some((n: string) => /Hafiz/.test(n))).toBe(true);
  });
});
