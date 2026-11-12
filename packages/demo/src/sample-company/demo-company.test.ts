import {
  type AppDeps,
  createApp,
  createMemoryFileStore,
  DEMO_COMPANY_DEFAULTS,
  fixedClock,
  schema,
  verifyChain,
} from "@crowhr/core";
import {
  createTestDb,
  createTestDeps,
  seedMember,
  seedOrg,
  TEST_PUBLIC_URL,
  TEST_SECRET_KEY,
  type TestDb,
  testClient,
} from "@crowhr/core/testing";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoCompanyProvisioner, demoCompanyPersonaInfo } from "./demo-company.ts";

/**
 * Demo companies with the real sample company (openspec add-demo-companies 1.4): two visitors'
 * copies on a server that also hosts a real organisation. Each copy is the whole Kopi Kaki, with
 * its own short name and email domain, no passwords and the demo flag set on insert; and the
 * people the try page promises work end to end: Hafiz applies for leave, Siti approves it.
 */
const NOW = new Date("2026-11-10T02:00:00.000Z"); // Tue 10 Nov 2026, 10:00 Singapore
const HOUR = 3_600_000;

interface Started {
  slug: string;
  expiresAt: string;
}
interface Person {
  membershipId: string;
  email: string;
  persona?: { key: string; label: string };
}

describe("demo companies with the real sample company", () => {
  let target: TestDb;
  let deps: AppDeps;
  let app: ReturnType<typeof createApp>;
  let real: { id: string; slug: string };
  let a: Started;
  let b: Started;
  const fileStore = createMemoryFileStore();

  beforeAll(async () => {
    target = await createTestDb();
    const base = createTestDeps(target.db, { clock: fixedClock(NOW), fileStore });
    real = await seedOrg(base, { slug: "real-co" });
    await seedMember(base, real.id, { roles: ["owner"], email: "owner@real.example", password: "correct horse" });
    deps = {
      ...base,
      demoCompanies: {
        ...DEMO_COMPANY_DEFAULTS,
        poolSize: 0,
        provision: createDemoCompanyProvisioner({
          target: target.db,
          fileStore,
          secretKey: TEST_SECRET_KEY,
          publicUrl: TEST_PUBLIC_URL,
          openScratch: createTestDb,
        }),
        personaInfo: demoCompanyPersonaInfo,
      },
    };
    app = createApp(deps);
    const start = async (ip: string) => {
      const res = await testClient(app, deps, { ip }).post("/api/v1/demo-companies", {});
      expect(res.status, await res.clone().text()).toBe(201);
      return (await res.json()) as Started;
    };
    a = await start("203.0.113.1");
    b = await start("203.0.113.2");
  }, 600_000);
  afterAll(() => target?.close());

  const orgOf = async (slug: string) => {
    const [org] = await target.db.select().from(schema.organisations).where(eq(schema.organisations.slug, slug));
    if (!org) throw new Error(`no ${slug}`);
    return org;
  };
  const people = async (slug: string) =>
    ((await (await app.request(`/api/v1/auth/demo/personas?org=${slug}`)).json()) as { items: Person[] }).items;

  it("lands two whole copies next to the real organisation, each with its own name and emails", async () => {
    expect(a.slug).not.toBe(b.slug);
    expect(a.expiresAt).toBe(new Date(NOW.getTime() + 72 * HOUR).toISOString());
    for (const s of [a, b]) {
      const org = await orgOf(s.slug);
      // The seed saves the company profile, which names the organisation by its trading name.
      expect(org.name).toBe("Kopi Kaki");
      expect(org.demoExpiresAt?.toISOString()).toBe(s.expiresAt);
      expect(org.demoClaimedAt?.toISOString()).toBe(NOW.toISOString());
      // organisations.uen is unique on the server: copies never take the sample company's UEN.
      expect(org.uen).toBeNull();
      const userIds = (
        await target.db
          .select({ id: schema.memberships.userId })
          .from(schema.memberships)
          .where(eq(schema.memberships.orgId, org.id))
      ).map((m) => m.id);
      expect(userIds).toHaveLength(13);
      const users = await target.db.select().from(schema.users).where(inArray(schema.users.id, userIds));
      for (const u of users) {
        expect(u.email.endsWith(`@${s.slug}.kopikaki.example`), u.email).toBe(true);
        expect(u.passwordHash).toBeNull();
      }
      const employees = await target.db
        .select({ workEmail: schema.employees.workEmail })
        .from(schema.employees)
        .where(eq(schema.employees.orgId, org.id));
      expect(employees.filter((e) => e.workEmail?.endsWith("@kopikaki.example"))).toEqual([]);
      expect((await verifyChain(target.db, org.id)).ok).toBe(true);
      const payslips = await target.db
        .select({ id: schema.payrollPayslips.id })
        .from(schema.payrollPayslips)
        .where(eq(schema.payrollPayslips.orgId, org.id));
      expect(payslips.length).toBeGreaterThan(20);
    }
    const files = await target.db.select({ key: schema.files.storageKey }).from(schema.files);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(await fileStore.get(f.key)).not.toBeNull();
  });

  it("features the owner, HR admin, payroll admin, manager and employee on the sign-in page", async () => {
    const featured = (await people(a.slug))
      .filter((p) => p.persona)
      .sort((x, y) => (x.persona?.label ?? "").localeCompare(y.persona?.label ?? ""));
    expect(featured.map((p) => [p.persona?.key, p.email.split("@")[0]])).toEqual([
      ["employee", "hafiz"],
      ["hr", "aisyah"],
      ["manager", "siti"],
      ["owner", "kahhui"],
      ["payroll", "chloe"],
    ]);
  });

  it("lets the employee apply for leave and the manager approve it, in that copy only", async () => {
    const all = await people(a.slug);
    const signIn = async (key: string) => {
      const p = all.find((x) => x.persona?.key === key);
      const http = testClient(app, deps);
      const res = await http.post("/api/v1/auth/demo/sign-in", { membershipId: p?.membershipId, org: a.slug });
      expect(res.status).toBe(204);
      return http;
    };
    const siti = await signIn("manager");
    type Tasks = { items: { taskId: string; subjectType: string; requester: { name: string } }[] };
    const before = (await (await siti.get("/api/v1/approvals/tasks")).json()) as Tasks;
    const hafiz = await signIn("employee");
    const types = (await (await hafiz.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] };
    const annual = types.items.find((t) => t.code === "annual");
    const roster = (await (await hafiz.get("/api/v1/scheduling/me?from=2026-11-23&to=2026-12-20")).json()) as {
      shifts: { date: string; kind: string }[];
    };
    let applied: Response | null = null;
    for (const s of roster.shifts.filter((x) => x.kind === "shift")) {
      applied = await hafiz.post("/api/v1/leave/requests", {
        leaveTypeId: annual?.id,
        startDate: s.date,
        endDate: s.date,
        reason: "Family dinner",
      });
      if (applied.status === 201) break;
    }
    expect(applied?.status).toBe(201);
    const request = (await applied?.json()) as { id: string };

    const after = (await (await siti.get("/api/v1/approvals/tasks")).json()) as Tasks;
    const fresh = after.items.filter((t) => !before.items.some((x) => x.taskId === t.taskId));
    expect(fresh.map((t) => [t.subjectType, t.requester.name])).toEqual([["leave", expect.stringContaining("Hafiz")]]);
    const task = fresh[0];
    const decided = await siti.post(`/api/v1/approvals/tasks/${task?.taskId}/decision`, {
      decision: "approve",
      comment: null,
    });
    expect(decided.status).toBe(200);

    // Copy B never saw it.
    const orgB = await orgOf(b.slug);
    const inB = await target.db
      .select({ id: schema.leaveRequests.id })
      .from(schema.leaveRequests)
      .where(eq(schema.leaveRequests.id, request.id));
    expect(inB).toHaveLength(1);
    const [row] = await target.db
      .select({ orgId: schema.leaveRequests.orgId })
      .from(schema.leaveRequests)
      .where(eq(schema.leaveRequests.id, request.id));
    expect(row?.orgId).not.toBe(orgB.id);
  });
});
