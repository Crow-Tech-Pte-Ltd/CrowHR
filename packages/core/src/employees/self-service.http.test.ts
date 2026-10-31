import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  nextNric,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { checklistInbox, employeeChecklists } from "./checklists.ts";
import { applyEvent, ctxFor, hire } from "./lifecycle.ts";
import { bankAccountForPayment } from "./profile.ts";
import { writeXlsx } from "./xlsx.ts";

let t: TestDb;
let h: PeopleHarness;
let s: BasicStructure;
let api: ReturnType<typeof createPeopleTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
  s = await seedBasicStructure(h);
  api = createPeopleTestApp(h.deps);
});
afterEach(() => t.close());

const hireOne = async (over: Parameters<typeof hirePayload>[1] = {}) =>
  (await hire(ctxFor(h.deps, h.ports, h.actor(OWNER)), hirePayload(s, over))).employeeId;

describe("self-service", () => {
  it("direct edit of mobile is saved immediately and audited", async () => {
    const me = await hireOne();
    const client = api.as(h.orgId, [], me);
    expect((await client.patch("/people/me/profile", { mobile: "8888 1234" })).status).toBe(204);
    const profile = await client.get("/people/me/profile");
    expect(profile.body.employee.personal.mobile).toBe("+6588881234");
    const ev = h.ports.audit.events.find((e) => e.action === "employee.self_updated");
    expect(ev?.diff?.mobileE164).toEqual({ from: null, to: "+6588881234" });
  });

  it("employees cannot directly edit sensitive fields", async () => {
    const me = await hireOne();
    const client = api.as(h.orgId, [], me);
    expect((await client.patch("/people/me/profile", { legalName: "New Name" })).status).toBe(400);
    expect((await client.patch(`/employees/${me}`, { legalName: "New Name" })).status).toBe(403);
    expect(
      (
        await client.post(`/employees/${me}/bank-accounts`, {
          bankCode: "DBSSSGSG",
          accountNumber: "1234567",
          holderName: "X",
          effectiveFrom: "2026-11-01",
        })
      ).status,
    ).toBe(403);
  });

  it("bank change needs payroll approval; payroll keeps the old account until then", async () => {
    const me = await hireOne();
    const pay = api.as(h.orgId, ["payroll_admin"]);
    await pay.post(`/employees/${me}/bank-accounts`, {
      bankCode: "DBSSSGSG",
      accountNumber: "0123456789",
      holderName: "Tan Mei Ling",
      effectiveFrom: "2026-01-05",
    });
    const client = api.as(h.orgId, [], me);
    const sub = await client.post("/people/me/change-requests", {
      bank: { bankCode: "OCBCSGSG", accountNumber: "5012345678", holderName: "Tan Mei Ling" },
    });
    expect(sub.status).toBe(201);
    expect(sub.body.items[0]).toMatchObject({
      status: "pending",
      routeToRole: "payroll_admin",
      proposed: { accountNumber: "••••5678" },
    });
    expect(h.ports.approvals.submissions[0]).toMatchObject({
      routeToRole: "payroll_admin",
      subjectType: "profile_change",
    });
    expect((await bankAccountForPayment(h.deps, h.ports, h.orgId, me, "2026-11-15"))?.bankCode).toBe("DBSSSGSG");
    const mine = await client.get("/people/me/profile");
    expect(mine.body.changeRequests[0].status).toBe("pending");
    // hr_admin cannot decide a bank request; the requester cannot decide their own.
    const reqId = sub.body.items[0].id;
    expect(
      (await api.as(h.orgId, ["hr_admin"]).post(`/people/change-requests/${reqId}/decision`, { decision: "approve" }))
        .status,
    ).toBe(403);
    expect(
      (
        await api
          .as(h.orgId, ["payroll_admin"], me)
          .post(`/people/change-requests/${reqId}/decision`, { decision: "approve" })
      ).status,
    ).toBe(403);
    const inbox = await pay.get("/people/inbox");
    expect(inbox.body.changeRequests.map((r: { id: string }) => r.id)).toEqual([reqId]);
    const ok = await pay.post(`/people/change-requests/${reqId}/decision`, {
      decision: "approve",
      effectiveFrom: "2026-11-01",
    });
    expect(ok.body.status).toBe("approved");
    expect((await bankAccountForPayment(h.deps, h.ports, h.orgId, me, "2026-10-31"))?.bankCode).toBe("DBSSSGSG");
    expect(await bankAccountForPayment(h.deps, h.ports, h.orgId, me, "2026-11-15")).toMatchObject({
      bankCode: "OCBCSGSG",
      accountNumber: "5012345678",
    });
    const dump = await t.pglite.query("select * from profile_change_requests");
    expect(JSON.stringify(dump.rows)).not.toContain("5012345678");
  });

  it("legal name change routes to hr_admin and applies on approval; pending values only visible to the employee", async () => {
    const me = await hireOne();
    const client = api.as(h.orgId, [], me);
    const nric = nextNric();
    const sub = await client.post("/people/me/change-requests", {
      personal: { legalName: "Tan Mei Ling Grace", idType: "nric", idNumber: nric },
    });
    expect(sub.body.items[0]).toMatchObject({ routeToRole: "hr_admin", proposed: { legalName: "Tan Mei Ling Grace" } });
    expect(sub.body.items[0].proposed.idNumber).toMatch(/^S\*{4}\d{3}[A-Z]$/);
    const hr = api.as(h.orgId, ["hr_admin"]);
    expect((await hr.get(`/employees/${me}`)).body.legalName).toBe("Tan Mei Ling");
    const res = await hr.post(`/people/change-requests/${sub.body.items[0].id}/decision`, { decision: "approve" });
    expect(res.status).toBe(200);
    const after = await hr.get(`/employees/${me}`);
    expect(after.body.legalName).toBe("Tan Mei Ling Grace");
    expect(after.body.personal.idNumberMasked).toBe(`${nric[0]}****${nric.slice(-4)}`);
    const pending = await client.post("/people/me/change-requests", { personal: { religion: "christianity" } });
    expect((await hr.get("/people/inbox")).body.changeRequests).toHaveLength(1);
    expect((await client.post(`/people/me/change-requests/${pending.body.items[0].id}/cancel`)).status).toBe(204);
    expect((await hr.get("/people/inbox")).body.changeRequests).toHaveLength(0);
  });
});

describe("checklists", () => {
  it("onboarding on hire: 'Issue KETs' due start + 14 for hr_admin; complete/skip by assignee role", async () => {
    const me = await hireOne({ person: { legalName: "Lim Wei Jie" }, job: { hireDate: "2026-12-01" } });
    const inbox = await checklistInbox(h.deps, h.actor(["hr_admin"]));
    const ket = inbox.find((i) => i.title === "Issue KETs: Lim Wei Jie");
    expect(ket?.dueOn).toBe("2026-12-15");
    const pay = api.as(h.orgId, ["payroll_admin"]);
    expect((await pay.post(`/people/checklist-items/${ket?.itemId}`, { action: "done" })).status).toBe(403);
    const hr = api.as(h.orgId, ["hr_admin"]);
    expect((await hr.post(`/people/checklist-items/${ket?.itemId}`, { action: "skip", reason: "" })).status).toBe(400);
    expect(
      (await hr.post(`/people/checklist-items/${ket?.itemId}`, { action: "skip", reason: "Signed on paper" })).status,
    ).toBe(204);
    const self = (await employeeChecklists(h.deps, h.actor([], me), me))[0];
    expect(self?.items.find((i) => i.title === "Issue KETs")).toMatchObject({
      status: "skipped",
      skipReason: "Signed on paper",
    });
    const mine = await checklistInbox(h.deps, h.actor([], me));
    expect(mine.map((i) => i.title)).toEqual(["Complete personal particulars: Lim Wei Jie"]);
  });

  it("manager items go to the manager", async () => {
    const boss = await hireOne({ person: { legalName: "Boss" } });
    await hireOne({ person: { legalName: "Newbie" }, job: { managerEmployeeId: boss, hireDate: "2026-11-02" } });
    const inbox = await checklistInbox(h.deps, h.actor([], boss));
    expect(inbox.map((i) => i.title)).toContain("Set up workstation and accounts: Newbie");
  });
});

describe("export", () => {
  it("manager: only their team; NRIC, compensation and bank columns not available", async () => {
    const boss = await hireOne({ person: { legalName: "Boss" } });
    await hireOne({ person: { legalName: "Report One" }, job: { managerEmployeeId: boss } });
    await hireOne({ person: { legalName: "Stranger" } });
    const mgr = api.as(h.orgId, [], boss);
    const cols = (await mgr.get("/employees/export/columns")).body.items.map((c: { key: string }) => c.key);
    expect(cols).not.toContain("id_number_masked");
    expect(cols).not.toContain("basic_pay");
    expect(cols).not.toContain("bank_account_last4");
    const res = await mgr.get("/employees/export?format=csv");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Report One");
    expect(res.text).not.toContain("Stranger");
    expect(
      res.text
        .replace(/^\ufeff/, "")
        .split("\r\n")
        .filter(Boolean),
    ).toHaveLength(2);
    expect((await mgr.get("/employees/export?columns=name,basic_pay")).status).toBe(403);
    const ev = h.ports.audit.events.find((e) => e.action === "employees.exported");
    expect(ev?.meta).toMatchObject({ rowCount: 1, format: "csv" });
  });

  it("hr_admin cannot export pay; payroll can; unmasked NRIC only on the re-auth route", async () => {
    await hireOne({ person: { legalName: "Tan Mei Ling", idNumber: "S1234567D" } });
    const hr = api.as(h.orgId, ["hr_admin"]);
    expect((await hr.get("/employees/export?columns=name,basic_pay")).status).toBe(403);
    const ok = await hr.get("/employees/export?columns=name,id_number_masked,race");
    expect(ok.text).toContain("S****567D");
    expect((await hr.get("/employees/export?columns=name,id_number")).status).toBe(403);
    const unmasked = await hr.get("/employees/export/unmasked?columns=name,id_number");
    expect(unmasked.text).toContain("S1234567D");
    const pay = api.as(h.orgId, ["payroll_admin"]);
    const pr = await pay.get("/employees/export?columns=name,basic_pay&format=xlsx");
    expect(pr.headers.get("content-type")).toContain("spreadsheetml");
    expect(pr.headers.get("content-disposition")).toContain(".xlsx");
  });

  it("writes a valid zip container for XLSX", () => {
    const bytes = writeXlsx(
      "Employees",
      ["Name", "Pay"],
      [
        ["Tan", "4000.00"],
        ["Lim", 12],
      ],
    );
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(bytes)).toContain("xl/worksheets/sheet1.xml");
  });
});

describe("leaving shows on the directory", () => {
  it("resignation shows Leaving on X; future transfer shows Scheduled in history", async () => {
    const me = await hireOne();
    await applyEvent(ctxFor(h.deps, h.ports, h.actor(OWNER)), me, {
      type: "transfer",
      effectiveDate: "2026-11-15",
      changes: { departmentId: s.departments.finance },
    });
    await applyEvent(ctxFor(h.deps, h.ports, h.actor(OWNER)), me, {
      type: "resignation",
      noticeGivenOn: "2026-11-03",
      noticeDays: 30,
    });
    const list = await api.as(h.orgId, ["hr_admin"]).get("/employees");
    expect(list.body.items[0].status).toMatchObject({ code: "leaving", label: "Leaving 2 Dec 2026" });
    const detail = await api.as(h.orgId, ["hr_admin"]).get(`/employees/${me}`);
    expect(detail.body.employment.events.map((e: { type: string; status: string }) => `${e.type}:${e.status}`)).toEqual(
      ["resignation:scheduled", "transfer:scheduled", "hire:effective"],
    );
  });
});
