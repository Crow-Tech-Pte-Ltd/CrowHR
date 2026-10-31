import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { employees } from "../db/schema/employees.ts";
import { departments } from "../db/schema/organisation.ts";
import { recordAudit, systemAuditContext } from "./audit.ts";

describe("audit log access", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let orgId: string;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
    orgId = (await seedOrg(deps)).id;
    const ctx = systemAuditContext(orgId, "system", "seed");
    for (const action of [
      "sso.provider_updated",
      "security_settings.updated",
      "compensation.updated",
      "payroll.finalised",
      "member.invited",
      "auth.signed_in",
    ]) {
      await recordAudit(deps.db, deps, ctx, {
        action,
        targetType: "x",
        targetId: action === "member.invited" ? "=HYPERLINK(1)" : action,
      });
    }
    await recordAudit(deps.db, deps, systemAuditContext((await seedOrg(deps)).id, "system", "other org"), {
      action: "member.invited",
      targetType: "x",
    });
  });
  afterAll(() => t.close());

  const actions = async (roles: ("owner" | "hr_admin" | "payroll_admin")[], query = "") => {
    const http = await clientAs(app, deps, await seedMember(deps, orgId, { roles }));
    const res = await http.get(`/api/v1/audit-events?pageSize=200${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: { action: string }[] }).items
      .map((i) => i.action)
      .filter((a) => !a.startsWith("audit_log."));
  };

  it("owners read everything in their organisation only", async () => {
    expect((await actions(["owner"])).sort()).toEqual(
      [
        "auth.signed_in",
        "compensation.updated",
        "member.invited",
        "payroll.finalised",
        "security_settings.updated",
        "sso.provider_updated",
      ].sort(),
    );
  });

  it("hr_admin cannot see SSO changes even when filtering for them", async () => {
    expect(await actions(["hr_admin"], "&action=sso.provider_updated")).toEqual([]);
    expect((await actions(["hr_admin"])).sort()).toEqual(["auth.signed_in", "member.invited"]);
  });

  it("payroll_admin sees payroll, compensation and bank events only", async () => {
    expect((await actions(["payroll_admin"])).sort()).toEqual(["compensation.updated", "payroll.finalised"]);
  });

  it("filters by action prefix and date range (Singapore dates)", async () => {
    expect(await actions(["owner"], "&action=auth.")).toEqual(["auth.signed_in"]);
    expect(await actions(["owner"], "&from=2026-11-01")).toEqual([]);
    expect((await actions(["owner"], "&from=2026-10-31&to=2026-10-31")).length).toBe(6);
  });

  it("employees are refused", async () => {
    const http = await clientAs(app, deps, await seedMember(deps, orgId, { employeeId: deps.ids.newId() }));
    expect((await http.get("/api/v1/audit-events")).status).toBe(403);
  });

  it("exports CSV with the same visibility, neutralises formulas, and audits the export", async () => {
    const http = await clientAs(app, deps, await seedMember(deps, orgId, { roles: ["hr_admin"] }));
    const res = await http.get("/api/v1/audit-events/export.csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).not.toContain("sso.provider_updated");
    expect(csv).toContain("member.invited");
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    const after = await actions(["owner"], "&action=audit_log.exported");
    expect(after).toEqual([]); // filtered out by the helper above; check directly:
    const owner = await clientAs(app, deps, await seedMember(deps, orgId, { roles: ["owner"] }));
    const exported = (await (await owner.get("/api/v1/audit-events?action=audit_log.exported")).json()) as {
      total: number;
    };
    expect(exported.total).toBeGreaterThanOrEqual(1);
  });
});

describe("audit log target labels", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
  });
  afterAll(() => t.close());

  const seedEmployee = async (orgId: string, legalName: string, preferredName: string | null = null) => {
    const id = deps.ids.newId();
    await deps.db.insert(employees).values({
      id,
      orgId,
      employeeNumber: `E-${id.slice(-6)}`,
      legalName,
      preferredName,
      idType: "nric",
      idNumberEnc: "enc",
      idNumberHmac: `hmac-${id}`,
      idNumberMasked: "S****567D",
      dob: "1990-01-01",
      residencyStatus: "citizen",
    });
    return id;
  };

  it("names members, employees, departments and the organisation, never another org's records", async () => {
    const org = await seedOrg(deps, { name: "Kopi Kaki Pte. Ltd." });
    const other = await seedOrg(deps);
    const member = await seedMember(deps, org.id, { displayName: "Tan Mei Ling" });
    const foreignMember = await seedMember(deps, other.id, { displayName: "Someone Else" });
    const employee = await seedEmployee(org.id, "Muhammad Hafiz bin Rahman", "Hafiz");
    const plainEmployee = await seedEmployee(org.id, "Lim Wei Jie");
    const foreignEmployee = await seedEmployee(other.id, "Not Yours");
    const departmentId = deps.ids.newId();
    await deps.db.insert(departments).values({ id: departmentId, orgId: org.id, name: "Roastery" });

    const ctx = systemAuditContext(org.id, "system", "seed");
    const targets: [string, string | null][] = [
      ["membership", member.membershipId],
      ["membership", foreignMember.membershipId],
      ["user", member.userId],
      ["user", foreignMember.userId],
      ["employee", employee],
      ["employee", plainEmployee],
      ["employee", foreignEmployee],
      ["department", departmentId],
      ["organisation", org.id],
      ["organisation", other.id],
      ["device_session", deps.ids.newId()],
      ["employee", "not-a-uuid"],
      ["audit_log", null],
    ];
    for (const [targetType, targetId] of targets)
      await recordAudit(deps.db, deps, ctx, { action: "x.labelled", targetType, targetId });

    const http = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const res = await http.get("/api/v1/audit-events?pageSize=50&sort=at&action=x.labelled");
    expect(res.status).toBe(200);
    const items = ((await res.json()) as { items: { targetType: string; targetLabel: string | null }[] }).items;
    expect(items.map((i) => [i.targetType, i.targetLabel])).toEqual([
      ["membership", "Tan Mei Ling"],
      ["membership", null], // another organisation's member is never named
      ["user", "Tan Mei Ling"],
      ["user", null], // users are global; only members of this organisation are named
      ["employee", "Hafiz"],
      ["employee", "Lim Wei Jie"],
      ["employee", null],
      ["department", "Roastery"],
      ["organisation", "Kopi Kaki Pte. Ltd."],
      ["organisation", null],
      ["device_session", null], // no cheap name: the UI falls back to the type
      ["employee", null], // not a UUID: never sent to the database
      ["audit_log", null],
    ]);
  });
});
