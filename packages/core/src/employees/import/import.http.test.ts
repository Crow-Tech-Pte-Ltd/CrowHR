import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../../testing/index.ts";
import { employees } from "../../db/schema/employees.ts";
import { fixedClock } from "../../deps.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  nextNric,
  type PeopleHarness,
  seedBasicStructure,
} from "../../testing/people-harness.ts";
import { createPeopleTestApp } from "../../../testing/people-http.ts";
import { ytdOpeningBalance } from "./service.ts";
import { TEMPLATES, templateCsv } from "./templates.ts";

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

const HEAD =
  "employee_number,legal_name,id_type,id_number,date_of_birth,residency_status,hire_date,job_title,department,employment_type,manager_employee_number,basic_pay";
const row = (n: number, over: Partial<Record<string, string>> = {}) => {
  const v = {
    employee_number: `E${String(100 + n)}`,
    legal_name: `Person ${n}`,
    id_type: "nric",
    id_number: nextNric(),
    date_of_birth: "15/06/1991",
    residency_status: "citizen",
    hire_date: "2026-02-02",
    job_title: "Crew",
    department: "Operations",
    employment_type: "full_time",
    manager_employee_number: "",
    basic_pay: "2600.00",
    ...over,
  };
  return [
    v.employee_number,
    v.legal_name,
    v.id_type,
    v.id_number,
    v.date_of_birth,
    v.residency_status,
    v.hire_date,
    v.job_title,
    v.department,
    v.employment_type,
    v.manager_employee_number,
    v.basic_pay,
  ].join(",");
};
const csv = (rows: string[]) => `${HEAD}\n${rows.join("\n")}\n`;

describe("employee import", () => {
  it("120 rows with a bad NRIC in row 7 and a missing department in row 52 → 118 valid, 2 errors, nothing written", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => {
      const line = i + 2;
      if (line === 7) return row(i, { id_number: "S1234567A" });
      if (line === 52) return row(i, { department: "" });
      return row(i);
    });
    const owner = api.as(h.orgId, ["owner"]);
    const res = await owner.post("/people/imports/employees/preview", { fileName: "staff.csv", content: csv(rows) });
    expect(res.status).toBe(201);
    expect(res.body.validRows).toBe(118);
    expect(res.body.canCommit).toBe(false);
    expect(res.body.errors).toEqual([
      {
        row: 7,
        column: "id_number",
        value: "S****567A",
        message: "This NRIC's check letter does not match. Check the last letter against the card.",
      },
      { row: 52, column: "department", value: "", message: "Enter the department name." },
    ]);
    expect(await t.db.select().from(employees).where(eq(employees.orgId, h.orgId))).toHaveLength(0);
    const commit = await owner.post(`/people/imports/${res.body.jobId}/commit`);
    expect(commit.status).toBe(409);
  });

  it("unknown department lists the closest existing name", async () => {
    const res = await api
      .as(h.orgId, ["owner"])
      .post("/people/imports/employees/preview", { content: csv([row(1, { department: "Finanse" })]) });
    expect(res.body.errors[0]).toMatchObject({ row: 2, column: "department", value: "Finanse" });
    expect(res.body.errors[0].message).toContain('"Finance"');
  });

  it("duplicate ID numbers in the file and bad dates are reported by cell", async () => {
    const nric = nextNric();
    const res = await api.as(h.orgId, ["owner"]).post("/people/imports/employees/preview", {
      content: csv([
        row(1, { id_number: nric }),
        row(2, { id_number: nric }),
        row(3, { hire_date: "02/30/2026" }),
        row(4, { date_of_birth: "1991-6-15" }),
      ]),
    });
    const byRow = Object.fromEntries(res.body.errors.map((e: { row: number; column: string }) => [e.row, e.column]));
    expect(byRow).toEqual({ 3: "id_number", 4: "hire_date", 5: "date_of_birth" });
    expect(res.body.errors[0].message).toContain("Rehire this person instead");
  });

  it("commit is all-or-nothing and creates everyone, managers resolved from earlier rows", async () => {
    const owner = api.as(h.orgId, ["owner"]);
    const res = await owner.post("/people/imports/employees/preview", {
      content: csv([row(1), row(2, { manager_employee_number: "E101" }), row(3, { manager_employee_number: "E102" })]),
    });
    expect(res.body).toMatchObject({ validRows: 3, canCommit: true, errors: [] });
    expect(await t.db.select().from(employees)).toHaveLength(0);
    const commit = await owner.post(`/people/imports/${res.body.jobId}/commit`);
    expect(commit.status).toBe(200);
    expect(commit.body.status).toBe("committed");
    expect((await t.db.select().from(employees)).map((e) => e.employeeNumber).sort()).toEqual(["E101", "E102", "E103"]);
    expect(h.ports.audit.events.some((e) => e.action === "import.employees.committed")).toBe(true);
    expect((await owner.post(`/people/imports/${res.body.jobId}/commit`)).status).toBe(409);
  });

  it("re-validates at commit: a conflicting change since the preview aborts everything", async () => {
    const owner = api.as(h.orgId, ["owner"]);
    const nric = nextNric();
    const res = await owner.post("/people/imports/employees/preview", {
      content: csv([row(1), row(2, { id_number: nric })]),
    });
    expect(res.body.canCommit).toBe(true);
    // Someone hires the second person by hand before the import is confirmed.
    const { hire, ctxFor } = await import("../lifecycle.ts");
    const { hirePayload } = await import("../../testing/people-harness.ts");
    await hire(ctxFor(h.deps, h.ports, h.actor(["owner"])), hirePayload(s, { person: { idNumber: nric } }));
    const commit = await owner.post(`/people/imports/${res.body.jobId}/commit`);
    expect(commit.status).toBe(409);
    expect(commit.body.error.details.reason).toBe("revalidation_failed");
    expect((await t.db.select().from(employees)).map((e) => e.employeeNumber)).toEqual(["E0001"]);
  });

  it("hr_admin cannot import pay; previews expire after 24 hours", async () => {
    const hr = api.as(h.orgId, ["hr_admin"]);
    const res = await hr.post("/people/imports/employees/preview", { content: csv([row(1)]) });
    expect(res.body.errors[0].column).toBe("basic_pay");
    const ok = await hr.post("/people/imports/employees/preview", { content: csv([row(1, { basic_pay: "" })]) });
    expect(ok.body.canCommit).toBe(true);
    const later = createPeopleTestApp({ ...h.deps, clock: fixedClock("2026-11-02T01:00:00Z") });
    const commit = await later.as(h.orgId, ["hr_admin"]).post(`/people/imports/${ok.body.jobId}/commit`);
    expect(commit.status).toBe(409);
    expect(commit.body.error.message).toContain("expired");
  });

  it("missing required header and unknown columns", async () => {
    const res = await api
      .as(h.orgId, ["owner"])
      .post("/people/imports/employees/preview", { content: "legal_name,colour\nA,red\n" });
    const msgs = res.body.errors.map((e: { message: string }) => e.message).join(" ");
    expect(msgs).toContain('"id_number" is missing');
    expect(msgs).toContain('Unknown column "colour"');
  });

  it("employees and payroll can't import into another org or see its jobs", async () => {
    const res = await api.as(h.orgId, ["owner"]).post("/people/imports/employees/preview", { content: csv([row(1)]) });
    const hB = await createPeopleHarness(h.deps, { orgName: "B" });
    const b = api.as(hB.orgId, ["owner"]);
    expect((await b.get(`/people/imports/${res.body.jobId}`)).status).toBe(404);
    expect((await b.post(`/people/imports/${res.body.jobId}/commit`)).status).toBe(404);
    expect(
      (
        await api
          .as(h.orgId, [], h.deps.ids.newId())
          .post("/people/imports/employees/preview", { content: csv([row(1)]) })
      ).status,
    ).toBe(403);
  });

  it("serves templates whose columns match the definitions", async () => {
    const res = await api.as(h.orgId, ["hr_admin"]).get("/people/imports/templates/employees");
    expect(res.headers.get("content-disposition")).toContain(TEMPLATES.employees.fileName);
    expect(res.text.replace(/^﻿/, "").split("\r\n")[0]).toBe(TEMPLATES.employees.columns.map((c) => c.name).join(","));
    expect(templateCsv("ytd").split("\r\n")[0]).toContain("ow_ytd");
  });
});

describe("YTD and compensation imports", () => {
  async function seedPeople() {
    const owner = api.as(h.orgId, ["owner"]);
    const res = await owner.post("/people/imports/employees/preview", { content: csv([row(1), row(2)]) });
    await owner.post(`/people/imports/${res.body.jobId}/commit`);
    const [e] = await t.db.select().from(employees).where(eq(employees.employeeNumber, "E101"));
    return e?.id as string;
  }

  it("ow_ytd 36000.00 through June → 3600000 cents for 2026", async () => {
    const id = await seedPeople();
    const pay = api.as(h.orgId, ["payroll_admin"]);
    const content =
      "employee_number,year,through_month,ow_ytd,aw_ytd,cpf_ee_ytd,cpf_er_ytd,shg_ytd\nE101,2026,2026-06,36000.00,5000.5,8200.10,6970.09,9.00\n";
    const res = await pay.post("/people/imports/ytd/preview", { content });
    expect(res.body).toMatchObject({ validRows: 1, canCommit: true });
    expect(await ytdOpeningBalance(t.db, h.orgId, id, 2026)).toBeNull();
    await pay.post(`/people/imports/${res.body.jobId}/commit`);
    expect(await ytdOpeningBalance(t.db, h.orgId, id, 2026)).toMatchObject({
      throughMonth: 6,
      owCents: 3_600_000,
      awCents: 500_050,
      cpfEeCents: 820_010,
      cpfErCents: 697_009,
      shgCents: 900,
      owCpfCents: null,
    });
  });

  it("one row per employee-year; hr_admin cannot import YTD", async () => {
    await seedPeople();
    const pay = api.as(h.orgId, ["payroll_admin"]);
    const content =
      "employee_number,year,through_month,ow_ytd,aw_ytd,cpf_ee_ytd,cpf_er_ytd,shg_ytd\nE101,2026,6,1,0,0,0,0\nE101,2026,6,1,0,0,0,0\nE999,2026,13,1.234,0,0,0,0\n";
    const res = await pay.post("/people/imports/ytd/preview", { content });
    const cols = res.body.errors.map((e: { row: number; column: string }) => `${e.row}:${e.column}`);
    expect(cols).toEqual(
      expect.arrayContaining(["3:employee_number", "4:employee_number", "4:through_month", "4:ow_ytd"]),
    );
    expect((await api.as(h.orgId, ["hr_admin"]).post("/people/imports/ytd/preview", { content })).status).toBe(403);
  });

  it("compensation import applies salary changes from their dates", async () => {
    const id = await seedPeople();
    const pay = api.as(h.orgId, ["payroll_admin"]);
    const res = await pay.post("/people/imports/compensation/preview", {
      content: "employee_number,effective_from,pay_basis,basic_pay,reason\nE101,01/01/2027,monthly,2800.00,Increment\n",
    });
    expect(res.body.canCommit).toBe(true);
    await pay.post(`/people/imports/${res.body.jobId}/commit`);
    const comp = await pay.get(`/employees/${id}/compensation`);
    expect(comp.body.history.map((r: { amountCents: number }) => r.amountCents)).toEqual([280_000, 260_000]);
  });
});
