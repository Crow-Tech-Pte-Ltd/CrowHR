import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  movableClock,
  seedMember,
  seedOrg,
  type TestDb,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { ErrorEnvelope } from "../errors.ts";

describe("MFA policy for privileged roles", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    app = createApp(deps);
    org = await seedOrg(deps);
  });
  afterAll(() => t.close());

  it("defaults to owner, hr_admin and payroll_admin", async () => {
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const s = (await (await owner.get("/api/v1/security/settings")).json()) as { mfaRequiredRoles: string[] };
    expect(s.mfaRequiredRoles).toEqual(["owner", "hr_admin", "payroll_admin"]);
  });

  it("allows a 7-day grace from the role grant, showing it in /me", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const hr = await seedMember(deps, org.id, { roles: ["hr_admin"], grantedAt: new Date("2026-10-25T01:00:00Z") });
    const http = await clientAs(app, deps, hr);
    const me = (await (await http.get("/api/v1/me")).json()) as {
      mfa: { required: boolean; graceEndsAt: string; blocked: boolean };
    };
    expect(me.mfa).toMatchObject({ required: true, blocked: false, graceEndsAt: "2026-11-01T01:00:00.000Z" });
    expect((await http.get("/api/v1/members")).status).toBe(200);
  });

  it("after the grace period, every request except enrolment and sign-out → 403 mfa_enrolment_required", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const hr = await seedMember(deps, org.id, { roles: ["hr_admin"], grantedAt: new Date("2026-10-23T01:00:00Z") });
    const http = await clientAs(app, deps, hr);
    const res = await http.get("/api/v1/members");
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("mfa_enrolment_required");
    expect((await http.get("/api/v1/me")).status).toBe(200);
    expect((await http.post("/api/v1/me/mfa/totp/setup")).status).toBe(200);
    expect((await http.post("/api/v1/auth/sign-out")).status).toBe(204);
  });

  it("does not apply to plain employees or to SSO sessions", async () => {
    const emp = await clientAs(
      app,
      deps,
      await seedMember(deps, org.id, { employeeId: deps.ids.newId(), grantedAt: new Date("2020-01-01") }),
    );
    expect((await emp.get("/api/v1/me/sessions")).status).toBe(200);
    const sso = await clientAs(
      app,
      deps,
      await seedMember(deps, org.id, { roles: ["hr_admin"], grantedAt: new Date("2020-01-01") }),
      { authMethod: "google" },
    );
    expect((await sso.get("/api/v1/members")).status).toBe(200);
  });
});
