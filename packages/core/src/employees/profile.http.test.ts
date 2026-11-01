import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  nextNric,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { bankAccountForPayment } from "./profile.ts";

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

const owner = () => api.as(h.orgId, ["owner"]);
async function hireVia(payload: ReturnType<typeof hirePayload>, client = owner()) {
  const res = await client.post("/employees", payload);
  if (res.status !== 201) throw new Error(`hire failed: ${res.status} ${res.text}`);
  return res.body.employeeId as string;
}

describe("create and read", () => {
  it("directory and detail identify an employee by full name while preserving their preferred name", async () => {
    const id = await hireVia(hirePayload(s, { person: { legalName: "Ahmad Ismail", preferredName: "Ahmad" } }));
    const directory = await owner().get("/employees");
    expect(directory.body.items.find((e: { id: string }) => e.id === id)).toMatchObject({
      name: "Ahmad Ismail",
      preferredName: "Ahmad",
    });
    expect((await owner().get(`/employees/${id}`)).body).toMatchObject({
      name: "Ahmad Ismail",
      preferredName: "Ahmad",
    });
  });

  it("required fields are named", async () => {
    const res = await owner().post("/employees", { person: { legalName: "" }, job: {} });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(["person.legalName", "person.idNumber", "person.dob", "job.hireDate", "job.departmentId"]),
    );
  });

  it("bad NRIC checksum gives the card message", async () => {
    const res = await owner().post("/employees", hirePayload(s, { person: { idNumber: "S1234567A" } }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0]).toEqual({
      path: "person.idNumber",
      message: "This NRIC's check letter does not match. Check the last letter against the card.",
    });
  });

  it("PR without start date names prStartDate; non-PR with one is rejected", async () => {
    const pr = await owner().post("/employees", hirePayload(s, { person: { residencyStatus: "pr" } }));
    expect(pr.status).toBe(400);
    expect(pr.body.error.details.issues.map((i: { path: string }) => i.path)).toContain("person.prStartDate");
    const cit = await owner().post("/employees", hirePayload(s, { person: { prStartDate: "2020-01-01" } }));
    expect(cit.status).toBe(400);
    const ok = await owner().post(
      "/employees",
      hirePayload(s, {
        person: {
          residencyStatus: "pr",
          prStartDate: "2025-03-15",
          sprCpfOption: "fg",
          sprCpfOptionApprovedOn: "2025-04-01",
        },
      }),
    );
    expect(ok.status).toBe(201);
  });

  it("duplicate ID → 409 duplicate_id_number with the former employee and a rehire offer", async () => {
    const nric = nextNric();
    const first = await hireVia(hirePayload(s, { person: { idNumber: nric } }));
    await owner().post(`/employees/${first}/events`, {
      type: "termination",
      reason: "contract_end",
      lastWorkingDay: "2026-06-30",
    });
    const res = await owner().post(
      "/employees",
      hirePayload(s, { person: { idNumber: nric.toLowerCase(), legalName: "Someone Else" } }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("duplicate_id_number");
    expect(res.body.error.details).toMatchObject({ existingEmployeeId: first });
    expect(res.body.error.message).toContain("Rehire this person instead");
  });

  it("NRIC is encrypted at rest and masked in responses", async () => {
    const id = await hireVia(hirePayload(s, { person: { idNumber: "S1234567D" } }));
    const dump = await t.pglite.query("select * from employees");
    expect(JSON.stringify(dump.rows)).not.toContain("S1234567D");
    expect(JSON.stringify(dump.rows)).not.toContain("1234567");
    const res = await owner().get(`/employees/${id}`);
    expect(res.body.personal.idNumberMasked).toBe("S****567D");
    expect(res.text).not.toContain("S1234567D");
  });

  it("hr_admin: compensation and bank absent and listed in redactedFields", async () => {
    const id = await hireVia(hirePayload(s));
    const res = await api.as(h.orgId, ["hr_admin"]).get(`/employees/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.compensation).toBeUndefined();
    expect(res.body.bank).toBeUndefined();
    expect(res.body.redactedFields).toEqual(expect.arrayContaining(["compensation", "bank"]));
    expect(res.body.personal).toBeDefined();
    const pay = await api.as(h.orgId, ["payroll_admin"]).get(`/employees/${id}`);
    expect(pay.body.compensation.current.amountCents).toBe(400_000);
    expect(pay.body.emergencyContacts).toBeUndefined();
  });

  it("a colleague's compensation is 404 for an employee; own is readable", async () => {
    const me = await hireVia(hirePayload(s));
    const colleague = await hireVia(hirePayload(s));
    const client = api.as(h.orgId, [], me);
    expect((await client.get(`/employees/${colleague}/compensation`)).status).toBe(404);
    expect((await client.get(`/employees/${me}/compensation`)).body.current.amountCents).toBe(400_000);
    const detail = await client.get(`/employees/${colleague}`);
    expect(detail.status).toBe(200); // directory is visible to all
    expect(detail.body.personal).toBeUndefined();
    expect(detail.body.employment).toBeUndefined();
  });

  it("a manager sees direct and indirect reports' employment, not personal details", async () => {
    const a = await hireVia(hirePayload(s, { person: { legalName: "Aisyah" } }));
    const b = await hireVia(hirePayload(s, { person: { legalName: "Boon" }, job: { managerEmployeeId: a } }));
    const c = await hireVia(hirePayload(s, { person: { legalName: "Chandra" }, job: { managerEmployeeId: b } }));
    const other = await hireVia(hirePayload(s, { person: { legalName: "Dev" } }));
    const mgr = api.as(h.orgId, [], a);
    const res = await mgr.get(`/employees/${c}`);
    expect(res.body.employment).toBeDefined();
    expect(res.body.personal).toBeUndefined();
    expect(res.body.emergencyContacts).toEqual([]);
    expect((await mgr.get(`/employees/${other}`)).body.employment).toBeUndefined();
    const team = await mgr.get("/employees?scope=team");
    expect(team.body.items.map((r: { name: string }) => r.name).sort()).toEqual(["Boon", "Chandra"]);
  });

  it("payroll_admin changing own salary → 403 self_change_requires_approval", async () => {
    const me = await hireVia(hirePayload(s));
    const res = await api.as(h.orgId, ["payroll_admin"], me).post(`/employees/${me}/events`, {
      type: "salary_change",
      effectiveDate: "2027-01-01",
      compensation: { payBasis: "monthly", amountCents: 999_999 },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("self_change_requires_approval");
  });

  it("future raise: as at 31 Dec 2026 is 400000, as at 1 Jan 2027 is 420000", async () => {
    const id = await hireVia(hirePayload(s));
    const res = await api.as(h.orgId, ["payroll_admin"]).post(`/employees/${id}/events`, {
      type: "salary_change",
      effectiveDate: "2027-01-01",
      compensation: { payBasis: "monthly", amountCents: 420_000, reason: "Annual increment" },
    });
    expect(res.body.status).toBe("scheduled");
    const comp = (await api.as(h.orgId, ["payroll_admin"]).get(`/employees/${id}/compensation`)).body;
    const at = (d: string) =>
      comp.history.find(
        (r: { effectiveFrom: string; effectiveTo: string | null }) =>
          r.effectiveFrom <= d && (!r.effectiveTo || d < r.effectiveTo),
      )?.amountCents;
    expect(at("2026-12-31")).toBe(400_000);
    expect(at("2027-01-01")).toBe(420_000);
    const ev = h.ports.audit.events.find((e) => e.action === "lifecycle.salary_change");
    expect(ev?.diff?.basicPayCents).toEqual({ changed: true });
  });

  it("retro change after September is finalised needs retroactive: true and notifies payroll", async () => {
    const id = await hireVia(hirePayload(s));
    h.ports.payroll.finalise(h.orgId, "2026-09-30");
    const body = {
      type: "salary_change",
      effectiveDate: "2026-09-01",
      compensation: { payBasis: "monthly", amountCents: 410_000 },
    };
    const res = await api.as(h.orgId, ["payroll_admin"]).post(`/employees/${id}/events`, body);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("September 2026 payroll is finalised");
    const ok = await api.as(h.orgId, ["payroll_admin"]).post(`/employees/${id}/events`, {
      ...body,
      compensation: { ...body.compensation, retroactive: true },
    });
    expect(ok.status).toBe(201);
    expect(h.ports.payroll.backPay).toMatchObject([
      { employeeId: id, previousAmountCents: 400_000, newAmountCents: 410_000 },
    ]);
  });

  it("amounts must be non-negative safe integers", async () => {
    const id = await hireVia(hirePayload(s));
    const pay = api.as(h.orgId, ["payroll_admin"]);
    for (const amountCents of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      const r = await pay.post(`/employees/${id}/events`, {
        type: "salary_change",
        effectiveDate: "2027-02-01",
        compensation: { payBasis: "monthly", amountCents },
      });
      expect(r.status).toBe(400);
    }
  });
});

describe("contacts", () => {
  it("normalises phones to E.164 with +65 and allows at most 3 emergency contacts", async () => {
    const id = await hireVia(hirePayload(s, { person: { mobile: "9123 4567" } }));
    const res = await owner().get(`/employees/${id}`);
    expect(res.body.personal.mobile).toBe("+6591234567");
    const c = { name: "Tan Ah Kow", relationship: "Father", phone: "81234567" };
    expect((await owner().put(`/employees/${id}/emergency-contacts`, { contacts: [c, c, c] })).status).toBe(204);
    const four = await owner().put(`/employees/${id}/emergency-contacts`, { contacts: [c, c, c, c] });
    expect(four.status).toBe(400);
    expect(four.body.error.details.issues[0].message).toContain("At most 3 emergency contacts");
    const bad = await owner().put(`/employees/${id}/emergency-contacts`, { contacts: [{ ...c, phone: "123" }] });
    expect(bad.status).toBe(400);
  });

  it("work email is unique among active employees", async () => {
    await hireVia(hirePayload(s, { person: { workEmail: "ali@kopikaki.sg" } }));
    const res = await owner().post("/employees", hirePayload(s, { person: { workEmail: "ALI@kopikaki.sg" } }));
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe("work_email_taken");
  });
});

describe("bank details", () => {
  it("DBS until 31 Oct, OCBC from 1 Nov; history kept, masked, encrypted", async () => {
    const id = await hireVia(hirePayload(s));
    const pay = api.as(h.orgId, ["payroll_admin"]);
    await pay.post(`/employees/${id}/bank-accounts`, {
      bankCode: "DBSSSGSG",
      accountNumber: "012-345678-9",
      holderName: "Tan Mei Ling",
      effectiveFrom: "2026-01-05",
    });
    const r = await pay.post(`/employees/${id}/bank-accounts`, {
      bankCode: "OCBCSGSG",
      accountNumber: "5012345678",
      holderName: "Tan Mei Ling",
      effectiveFrom: "2026-11-01",
    });
    expect(r.body.accountMasked).toBe("••••5678");
    expect((await bankAccountForPayment(h.deps, h.ports, h.orgId, id, "2026-10-31"))?.bankCode).toBe("DBSSSGSG");
    expect(await bankAccountForPayment(h.deps, h.ports, h.orgId, id, "2026-11-01")).toMatchObject({
      bankCode: "OCBCSGSG",
      accountNumber: "5012345678",
    });
    const detail = await pay.get(`/employees/${id}`);
    expect(detail.body.bank.history).toHaveLength(2);
    expect(detail.body.bank.current.accountLast4).toBe("3456".replace("3456", "6789"));
    const dump = await t.pglite.query("select * from bank_accounts");
    expect(JSON.stringify(dump.rows)).not.toContain("5012345678");
    expect(
      (
        await api.as(h.orgId, ["hr_admin"]).post(`/employees/${id}/bank-accounts`, {
          bankCode: "DBSSSGSG",
          accountNumber: "1234567",
          holderName: "X",
          effectiveFrom: "2026-12-01",
        })
      ).status,
    ).toBe(403);
  });
});

describe("work passes", () => {
  it("an expired pass with no later pass shows Work pass expired in the list; pass number encrypted", async () => {
    const id = await hireVia(
      hirePayload(s, {
        person: { idType: "fin", idNumber: nextNric("G"), residencyStatus: "foreigner", legalName: "Raj Kumar" },
        job: { hireDate: "2025-01-06" },
        workPass: { passType: "S_PASS", passNumber: "G7654321P", issuedOn: "2025-01-01", expiresOn: "2026-10-15" },
      }),
    );
    const list = await api.as(h.orgId, ["hr_admin"]).get("/employees");
    expect(list.body.items.find((r: { id: string }) => r.id === id).workPassState).toBe("expired");
    const asEmployee = await api.as(h.orgId, [], await hireVia(hirePayload(s))).get("/employees");
    expect(asEmployee.body.items.find((r: { id: string }) => r.id === id).workPassState).toBeNull();
    await api.as(h.orgId, ["hr_admin"]).post(`/employees/${id}/work-passes`, {
      passType: "S_PASS",
      passNumber: "G7654321P",
      issuedOn: "2026-10-01",
      expiresOn: "2028-10-15",
    });
    const after = await api.as(h.orgId, ["hr_admin"]).get("/employees");
    expect(after.body.items.find((r: { id: string }) => r.id === id).workPassState).toBe("valid");
    const dump = await t.pglite.query("select * from work_passes");
    expect(JSON.stringify(dump.rows)).not.toContain("7654321");
  });
});

describe("cross-organisation isolation (every employees route)", () => {
  it("org B gets 404 (or an empty list) for everything in org A", async () => {
    const id = await hireVia(hirePayload(s));
    const hB = await createPeopleHarness(h.deps, { orgName: "Other Pte. Ltd." });
    const b = api.as(hB.orgId, ["owner", "hr_admin", "payroll_admin"]);
    expect((await b.get("/employees")).body.items).toEqual([]);
    expect((await b.get(`/employees/${id}`)).status).toBe(404);
    expect((await b.patch(`/employees/${id}`, { preferredName: "X" })).status).toBe(404);
    expect((await b.put(`/employees/${id}/emergency-contacts`, { contacts: [] })).status).toBe(404);
    expect(
      (
        await b.post(`/employees/${id}/events`, {
          type: "transfer",
          effectiveDate: "2026-12-01",
          changes: { jobTitle: "X" },
        })
      ).status,
    ).toBe(404);
    expect((await b.get(`/employees/${id}/compensation`)).status).toBe(404);
    expect((await b.post(`/employees/${id}/work-passes`, { passType: "EP", expiresOn: "2027-01-01" })).status).toBe(
      404,
    );
    expect(
      (
        await b.post(`/employees/${id}/bank-accounts`, {
          bankCode: "DBSSSGSG",
          accountNumber: "1234567",
          holderName: "X",
          effectiveFrom: "2026-12-01",
        })
      ).status,
    ).toBe(404);
    expect((await b.get(`/employees/${id}/checklists`)).status).toBe(404);
    const exp = await b.get("/employees/export");
    expect(exp.text).not.toContain("Tan Mei Ling");
    // Org B cannot reference org A's department when hiring.
    const sB = await seedBasicStructure(hB);
    const cross = await b.post("/employees", hirePayload(sB, { job: { departmentId: s.departments.sales } }));
    expect(cross.status).toBe(400);
  });

  it("the database rejects a cross-org employment record", async () => {
    const id = await hireVia(hirePayload(s));
    const hB = await createPeopleHarness(h.deps, { orgName: "Other Pte. Ltd." });
    await expect(
      t.pglite.query(
        `insert into emergency_contacts (id, org_id, employee_id, name, relationship, phone_e164, position) values ($1, $2, $3, 'x', 'y', '+6581234567', 0)`,
        [h.deps.ids.newId(), hB.orgId, id],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
