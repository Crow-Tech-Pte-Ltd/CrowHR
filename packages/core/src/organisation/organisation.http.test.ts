import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { createPeopleHarness, hirePayload, type PeopleHarness, seedBasicStructure } from "../testing/people-harness.ts";

let t: TestDb;
let h: PeopleHarness;
let api: ReturnType<typeof createPeopleTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
  api = createPeopleTestApp(h.deps);
});
afterEach(() => t.close());

const profile = {
  legalName: "Kopi Kaki Pte. Ltd.",
  uen: "201912345K",
  csn: "201912345KPTE01",
  addressBlock: "1",
  addressStreet: "Tanjong Pagar Plaza",
  postalCode: "082001",
};

describe("company profile", () => {
  it("owner and hr_admin write; others read only", async () => {
    const owner = api.as(h.orgId, ["owner"]);
    const res = await owner.put("/organisation/profile", profile);
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      uen: "201912345K",
      payrollReady: true,
      timeZone: "Asia/Singapore",
      currency: "SGD",
    });
    expect(
      (await api.as(h.orgId, ["hr_admin"]).put("/organisation/profile", { ...profile, tradingName: "Kopi Kaki" }))
        .status,
    ).toBe(200);
    const payroll = api.as(h.orgId, ["payroll_admin"]);
    expect((await payroll.put("/organisation/profile", profile)).status).toBe(403);
    expect((await payroll.get("/organisation/profile")).body.profile.tradingName).toBe("Kopi Kaki");
    expect(h.ports.audit.events.map((e) => e.action)).toEqual(["company_profile.created", "company_profile.updated"]);
  });

  it("invalid UEN lists the three formats with examples", async () => {
    const res = await api.as(h.orgId, ["owner"]).put("/organisation/profile", { ...profile, uen: "12345", csn: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    const msg = res.body.error.details.issues.find((i: { path: string }) => i.path === "uen").message;
    for (const ex of ["53312345D", "201912345K", "T09LL0001B"]) expect(msg).toContain(ex);
  });

  it("CSN must begin with the UEN", async () => {
    const res = await api.as(h.orgId, ["owner"]).put("/organisation/profile", { ...profile, csn: "201812345KPTE01" });
    expect(res.status).toBe(400);
    const issue = res.body.error.details.issues.find((i: { path: string }) => i.path === "csn");
    expect(issue.message).toContain("must begin with the organisation's UEN");
  });

  it("payroll readiness lists what is missing", async () => {
    const res = await api
      .as(h.orgId, ["owner"])
      .put("/organisation/profile", { legalName: "X Pte. Ltd.", uen: "53312345D" });
    expect(res.body.profile).toMatchObject({ payrollReady: false, missingForPayroll: ["csn", "address"] });
  });

  it("logo: PNG or SVG, at most 1 MB; requires a profile", async () => {
    const owner = api.as(h.orgId, ["owner"]);
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
    expect((await owner.put("/organisation/profile/logo", { contentType: "image/png", dataBase64: png })).status).toBe(
      409,
    );
    await owner.put("/organisation/profile", profile);
    expect((await owner.put("/organisation/profile/logo", { contentType: "image/jpeg", dataBase64: png })).status).toBe(
      400,
    );
    const big = btoa("x".repeat(1024 * 1024 + 1));
    expect(
      (await owner.put("/organisation/profile/logo", { contentType: "image/png", dataBase64: big.slice(0, 1_499_000) }))
        .status,
    ).toBe(400);
    expect((await owner.put("/organisation/profile/logo", { contentType: "image/png", dataBase64: png })).status).toBe(
      204,
    );
    const logo = await api.as(h.orgId, ["owner"]).get("/organisation/profile/logo");
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
  });
});

describe("structure", () => {
  it("unique active names; archived names can be reused", async () => {
    const hr = api.as(h.orgId, ["hr_admin"]);
    const a = await hr.post("/organisation/structure/departments", { name: "Sales" });
    expect(a.status).toBe(201);
    const dup = await hr.post("/organisation/structure/departments", { name: "sales" });
    expect(dup.status).toBe(409);
    await hr.post(`/organisation/structure/departments/${a.body.id}/archive`, { archived: true });
    expect((await hr.post("/organisation/structure/departments", { name: "Sales" })).status).toBe(201);
    expect(
      (await api.as(h.orgId, ["payroll_admin"]).post("/organisation/structure/departments", { name: "Ops" })).status,
    ).toBe(403);
  });

  it("archiving a department with 4 current employees → 409 in_use with count 4", async () => {
    const s = await seedBasicStructure(h);
    const { hire, ctxFor } = await import("../employees/lifecycle.ts");
    for (let i = 0; i < 4; i++) await hire(ctxFor(h.deps, h.ports, h.actor(["owner"])), hirePayload(s));
    const res = await api
      .as(h.orgId, ["hr_admin"])
      .post(`/organisation/structure/departments/${s.departments.sales}/archive`, { archived: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("in_use");
    expect(res.body.error.details).toMatchObject({ count: 4 });
    expect(res.body.error.details.link).toContain(s.departments.sales);
    const list = await api.as(h.orgId, ["payroll_admin"]).get("/organisation/structure/departments");
    expect(list.body.items.find((d: { id: string }) => d.id === s.departments.sales).employeeCount).toBe(4);
  });

  it("teams belong to an active department", async () => {
    const hr = api.as(h.orgId, ["hr_admin"]);
    const d = await hr.post("/organisation/structure/departments", { name: "Ops" });
    expect((await hr.post("/organisation/structure/teams", { name: "Kitchen", departmentId: d.body.id })).status).toBe(
      201,
    );
    await hr.post(`/organisation/structure/departments/${d.body.id}/archive`, { archived: true });
    expect((await hr.post("/organisation/structure/teams", { name: "Bar", departmentId: d.body.id })).status).toBe(400);
  });
});

describe("work schedules over HTTP", () => {
  it("creates Office 5-day at 40 h; no rest day fails with the fix", async () => {
    const hr = api.as(h.orgId, ["hr_admin"]);
    const week = [480, 480, 480, 480, 480].map((m) => ({ type: "working", minutes: m }));
    const ok = await hr.post("/organisation/work-schedules", {
      name: "Office 5-day",
      kind: "fixed",
      days: [...week, { type: "off", minutes: 0 }, { type: "rest", minutes: 0 }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ isDefault: true, current: { weeklyMinutes: 2400 } });
    const bad = await hr.post("/organisation/work-schedules", {
      name: "No rest",
      kind: "fixed",
      days: [...week, { type: "off", minutes: 0 }, { type: "off", minutes: 0 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe("Mark exactly one day as the rest day (usually Sunday).");
  });
});

describe("cross-organisation isolation", () => {
  it("org B cannot read or change org A's structure", async () => {
    const a = api.as(h.orgId, ["owner"]);
    const dept = await a.post("/organisation/structure/departments", { name: "Sales" });
    await a.put("/organisation/profile", profile);
    const hB = await createPeopleHarness(h.deps, { orgName: "Other Pte. Ltd." });
    const b = api.as(hB.orgId, ["owner"]);
    expect((await b.get("/organisation/structure/departments")).body.items).toEqual([]);
    expect((await b.get("/organisation/profile")).body.profile).toBeNull();
    expect((await b.patch(`/organisation/structure/departments/${dept.body.id}`, { name: "Hijack" })).status).toBe(404);
    expect(
      (await b.post(`/organisation/structure/departments/${dept.body.id}/archive`, { archived: true })).status,
    ).toBe(404);
    expect((await b.post("/organisation/structure/teams", { name: "T", departmentId: dept.body.id })).status).toBe(400);
  });

  it("unauthenticated → 401", async () => {
    expect((await api.anonymous("/organisation/profile")).status).toBe(401);
  });
});
