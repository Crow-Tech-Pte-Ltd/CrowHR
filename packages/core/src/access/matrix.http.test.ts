import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  seedMember,
  type TestClient,
  type TestDb,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { AppDeps } from "../deps.ts";
import { applyEvent, ctxFor, hire } from "../employees/lifecycle.ts";
import { createReportingScopeResolver } from "../employees/reports/reporting-scope.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { MATRIX, type Permission, type Role, type Scope } from "./matrix.ts";

/**
 * Table-driven permission test (access-control "Matrix enforced per cell"). One stub route per
 * matrix row; every row × role × in-scope/out-of-scope record is asserted. A module adding a
 * row to MATRIX gets it tested here automatically.
 *
 * Manager scope comes from the real `ReportingScopeResolver` (people module) over real
 * employment records: manager ← report ← indirect, plus an unrelated employee and an "other".
 */
type Who = "manager" | "report" | "indirect" | "employee" | "other";
const EMP = {} as Record<Who, string>;

/** Hires the five employees with their reporting lines; returns a deps with the real resolver wired. */
async function seedReportingLines(deps: AppDeps): Promise<{ h: PeopleHarness; s: BasicStructure; deps: AppDeps }> {
  const h = await createPeopleHarness(deps);
  const s = await seedBasicStructure(h);
  const ctx = ctxFor(h.deps, h.ports, h.actor(OWNER));
  const hireOne = async (managerEmployeeId: string | null = null) =>
    (await hire(ctx, hirePayload(s, { job: { managerEmployeeId }, compensation: null }))).employeeId;
  EMP.manager = await hireOne();
  EMP.report = await hireOne(EMP.manager);
  EMP.indirect = await hireOne(EMP.report);
  EMP.employee = await hireOne();
  EMP.other = await hireOne();
  return { h, s, deps: { ...h.deps, reportingScope: createReportingScopeResolver(deps.db) } };
}

const permissions = Object.keys(MATRIX) as Permission[];
const stub = defineModule({
  name: "stub",
  basePath: "/stub",
  routes: permissions.map((permission) =>
    defineRoute({
      method: "get",
      path: `/${permission.replace(":", "/")}/:employeeId`,
      summary: `Stub for ${permission}`,
      operationId: `stub.${permission}`,
      access: { permission },
      request: { params: z.object({ employeeId: z.uuid() }) },
      responses: { 200: z.object({ ok: z.literal(true) }) },
      errors: ["not_found"],
      crossOrgExempt: "test stub",
      handler: async ({ grant, params }) => {
        await grant.assertEmployee(params.employeeId);
        return { ok: true as const };
      },
    }),
  ),
});

/** Roles a test member effectively holds. A manager is always also an employee (derived from the employee link). */
const PERSONAS: Record<
  Role,
  {
    roles: ("owner" | "hr_admin" | "payroll_admin")[];
    effective: Role[];
    /** The persona's own employee record, if linked. */
    self: Who | null;
  }
> = {
  owner: { roles: ["owner"], effective: ["owner"], self: null },
  hr_admin: { roles: ["hr_admin"], effective: ["hr_admin"], self: null },
  payroll_admin: { roles: ["payroll_admin"], effective: ["payroll_admin"], self: null },
  manager: { roles: [], effective: ["manager", "employee"], self: "manager" },
  employee: { roles: [], effective: ["employee"], self: "employee" },
};

function scopesFor(permission: Permission, effective: Role[]): Set<Scope> {
  const cells: Partial<Record<Role, Scope>> = MATRIX[permission].cells;
  return new Set(effective.flatMap((r) => (cells[r] ? [cells[r] as Scope] : [])));
}

describe("permission matrix", () => {
  let t: TestDb;
  let app: ReturnType<typeof createApp>;
  const clients = new Map<Role, TestClient>();
  beforeAll(async () => {
    t = await createTestDb();
    const { h, deps } = await seedReportingLines(createTestDeps(t.db));
    app = createApp(deps, { modules: [stub] });
    for (const [role, p] of Object.entries(PERSONAS) as [Role, (typeof PERSONAS)[Role]][]) {
      const employeeId = p.self ? EMP[p.self] : null;
      clients.set(role, await clientAs(app, deps, await seedMember(deps, h.orgId, { roles: p.roles, employeeId })));
    }
  });
  afterAll(() => t.close());

  const cases: { permission: Permission; role: Role; target: Who; label: string; expected: number }[] = [];
  for (const permission of permissions) {
    for (const role of Object.keys(PERSONAS) as Role[]) {
      const p = PERSONAS[role];
      const scopes = scopesFor(permission, p.effective);
      if (scopes.size === 0) {
        cases.push({ permission, role, target: "other", label: "denied", expected: 403 });
        continue;
      }
      if (scopes.has("all")) {
        cases.push({ permission, role, target: "other", label: "all", expected: 200 });
        continue;
      }
      if (scopes.has("team")) {
        cases.push({ permission, role, target: "report", label: "team (direct)", expected: 200 });
        cases.push({ permission, role, target: "indirect", label: "team (indirect)", expected: 200 });
      }
      if (scopes.has("own") && p.self) cases.push({ permission, role, target: p.self, label: "own", expected: 200 });
      if (!scopes.has("own") && p.self)
        cases.push({ permission, role, target: p.self, label: "self outside scope", expected: 404 });
      cases.push({ permission, role, target: "other", label: "out of scope", expected: 404 });
    }
  }

  it("covers every matrix row for every role", () => {
    expect(new Set(cases.map((c) => c.permission)).size).toBe(permissions.length);
    expect(cases.length).toBeGreaterThan(permissions.length * 5);
  });

  it.each(cases)("$permission as $role, $label → $expected", async ({ permission, role, target, expected }) => {
    const res = await (clients.get(role) as TestClient).get(
      `/api/v1/stub/${permission.replace(":", "/")}/${EMP[target]}`,
    );
    expect(res.status).toBe(expected);
  });

  // Spec scenarios, spelled out.
  it("employee reading a colleague's compensation gets 404, not 403", async () => {
    expect(
      (await (clients.get("employee") as TestClient).get(`/api/v1/stub/compensation/read/${EMP.other}`)).status,
    ).toBe(404);
  });
  it("hr_admin cannot read compensation at all (403)", async () => {
    expect(
      (await (clients.get("hr_admin") as TestClient).get(`/api/v1/stub/compensation/read/${EMP.other}`)).status,
    ).toBe(403);
  });
  it("a manager sees an indirect report's leave", async () => {
    expect((await (clients.get("manager") as TestClient).get(`/api/v1/stub/leave/read/${EMP.indirect}`)).status).toBe(
      200,
    );
  });
  it("unauthenticated → 401", async () => {
    expect((await app.request(`/api/v1/stub/leave/read/${EMP.other}`)).status).toBe(401);
  });
});

describe("manager scope follows reporting-line changes on the next request", () => {
  it("a former report is hidden as soon as their manager changes", async () => {
    const t = await createTestDb();
    try {
      const { h, deps } = await seedReportingLines(createTestDeps(t.db));
      const app = createApp(deps, { modules: [stub] });
      const http = await clientAs(app, deps, await seedMember(deps, h.orgId, { employeeId: EMP.manager }));
      expect((await http.get(`/api/v1/stub/employment/read/${EMP.report}`)).status).toBe(200);
      // Both reports move to another manager today (31 Oct 2026, the test clock).
      const ctx = ctxFor(h.deps, h.ports, h.actor(OWNER));
      for (const who of ["report", "indirect"] as const) {
        await applyEvent(ctx, EMP[who], {
          type: "transfer",
          effectiveDate: "2026-10-31",
          changes: { managerEmployeeId: EMP.other },
        });
      }
      expect((await http.get(`/api/v1/stub/employment/read/${EMP.report}`)).status).toBe(404);
      // No reports left → no manager role → leave:read falls back to own only.
      expect((await http.get(`/api/v1/stub/leave/read/${EMP.report}`)).status).toBe(404);
    } finally {
      await t.close();
    }
  });
});
