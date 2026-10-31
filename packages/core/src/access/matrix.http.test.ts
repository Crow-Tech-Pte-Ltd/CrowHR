import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  seedMember,
  seedOrg,
  type TestClient,
  type TestDb,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { MATRIX, type Permission, type Role, type Scope } from "./matrix.ts";
import { createStaticReportingScope } from "./scope.ts";

/**
 * Table-driven permission test (access-control "Matrix enforced per cell"). One stub route per
 * matrix row; every row × role × in-scope/out-of-scope record is asserted. A module adding a
 * row to MATRIX gets it tested here automatically.
 */
const EMP = {
  manager: "00000000-0000-7000-8000-00000000000a",
  report: "00000000-0000-7000-8000-00000000000b",
  indirect: "00000000-0000-7000-8000-00000000000c",
  employee: "00000000-0000-7000-8000-00000000000d",
  other: "00000000-0000-7000-8000-00000000000e",
};
const reporting = createStaticReportingScope({ [EMP.manager]: [EMP.report], [EMP.report]: [EMP.indirect] });

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
    employeeId: string | null;
    effective: Role[];
    self: string | null;
  }
> = {
  owner: { roles: ["owner"], employeeId: null, effective: ["owner"], self: null },
  hr_admin: { roles: ["hr_admin"], employeeId: null, effective: ["hr_admin"], self: null },
  payroll_admin: { roles: ["payroll_admin"], employeeId: null, effective: ["payroll_admin"], self: null },
  manager: { roles: [], employeeId: EMP.manager, effective: ["manager", "employee"], self: EMP.manager },
  employee: { roles: [], employeeId: EMP.employee, effective: ["employee"], self: EMP.employee },
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
    const deps = createTestDeps(t.db, { reportingScope: reporting });
    app = createApp(deps, { modules: [stub] });
    const org = await seedOrg(deps);
    for (const [role, p] of Object.entries(PERSONAS) as [Role, (typeof PERSONAS)[Role]][]) {
      clients.set(
        role,
        await clientAs(app, deps, await seedMember(deps, org.id, { roles: p.roles, employeeId: p.employeeId })),
      );
    }
  });
  afterAll(() => t.close());

  const cases: { permission: Permission; role: Role; target: string; label: string; expected: number }[] = [];
  for (const permission of permissions) {
    for (const role of Object.keys(PERSONAS) as Role[]) {
      const p = PERSONAS[role];
      const scopes = scopesFor(permission, p.effective);
      if (scopes.size === 0) {
        cases.push({ permission, role, target: EMP.other, label: "denied", expected: 403 });
        continue;
      }
      if (scopes.has("all")) {
        cases.push({ permission, role, target: EMP.other, label: "all", expected: 200 });
        continue;
      }
      if (scopes.has("team")) {
        cases.push({ permission, role, target: EMP.report, label: "team (direct)", expected: 200 });
        cases.push({ permission, role, target: EMP.indirect, label: "team (indirect)", expected: 200 });
      }
      if (scopes.has("own") && p.self) cases.push({ permission, role, target: p.self, label: "own", expected: 200 });
      if (!scopes.has("own") && p.self)
        cases.push({ permission, role, target: p.self, label: "self outside scope", expected: 404 });
      cases.push({ permission, role, target: EMP.other, label: "out of scope", expected: 404 });
    }
  }

  it("covers every matrix row for every role", () => {
    expect(new Set(cases.map((c) => c.permission)).size).toBe(permissions.length);
    expect(cases.length).toBeGreaterThan(permissions.length * 5);
  });

  it.each(cases)("$permission as $role, $label → $expected", async ({ permission, role, target, expected }) => {
    const res = await (clients.get(role) as TestClient).get(`/api/v1/stub/${permission.replace(":", "/")}/${target}`);
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
  it("a former report is hidden as soon as the resolver changes", async () => {
    const t = await createTestDb();
    try {
      const lines: Record<string, string[]> = { [EMP.manager]: [EMP.report] };
      const deps = createTestDeps(t.db, { reportingScope: { teamOf: async (_o, m) => new Set(lines[m] ?? []) } });
      const app = createApp(deps, { modules: [stub] });
      const org = await seedOrg(deps);
      const http = await clientAs(app, deps, await seedMember(deps, org.id, { employeeId: EMP.manager }));
      expect((await http.get(`/api/v1/stub/employment/read/${EMP.report}`)).status).toBe(200);
      lines[EMP.manager] = [];
      expect((await http.get(`/api/v1/stub/employment/read/${EMP.report}`)).status).toBe(404);
      // No reports left → no manager role → leave:read falls back to own only.
      expect((await http.get(`/api/v1/stub/leave/read/${EMP.report}`)).status).toBe(404);
    } finally {
      await t.close();
    }
  });
});
