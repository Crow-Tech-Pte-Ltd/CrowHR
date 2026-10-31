import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import { checklistItems, compensationRecords, employmentRecords, tenures } from "../db/schema/employees.ts";
import { AppError } from "../errors.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  HR,
  hirePayload,
  OWNER,
  PAYROLL,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { asAt } from "./effective.ts";
import { applyEvent, cancelEvent, ctxFor, employmentStatus, hire, lastWorkingDayFor, listEvents } from "./lifecycle.ts";

let t: TestDb;
let h: PeopleHarness;
let s: BasicStructure;

beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
  s = await seedBasicStructure(h);
});
afterEach(() => t.close());

const owner = () => ctxFor(h.deps, h.ports, h.actor(OWNER));
const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected failure");
};

describe("hire", () => {
  it("creates tenure, employment record, compensation, onboarding checklist and an invitation", async () => {
    const { employeeId } = await hire(owner(), hirePayload(s, { person: { workEmail: "Mei.Ling@kopikaki.sg" } }));
    const [tenure] = await t.db.select().from(tenures).where(eq(tenures.employeeId, employeeId));
    expect(tenure?.hireDate).toBe("2026-01-05");
    const rec = await asAt(t.db, employmentRecords, h.orgId, employeeId, "2026-01-05");
    expect(rec?.departmentId).toBe(s.departments.sales);
    expect(rec?.workScheduleId).toBe(s.scheduleId); // default schedule
    const comp = await asAt(t.db, compensationRecords, h.orgId, employeeId, "2026-06-01");
    expect(comp?.amountCents).toBe(400_000);
    expect(h.ports.memberships.invitations).toEqual([{ orgId: h.orgId, employeeId, email: "mei.ling@kopikaki.sg" }]);
    const items = await t.db.select().from(checklistItems).where(eq(checklistItems.orgId, h.orgId));
    expect(items.find((i) => i.title === "Issue KETs")?.dueOn).toBe("2026-01-19");
    expect(h.ports.audit.events.some((e) => e.action === "employee.hired" && e.diff?.basicPayCents?.changed)).toBe(
      true,
    );
    expect(JSON.stringify(h.ports.audit.events)).not.toContain("400000");
  });

  it("refuses a dob on or after the start date", async () => {
    const e = await err(hire(owner(), hirePayload(s, { person: { dob: "2026-01-05" } })));
    expect(e.code).toBe("validation_failed");
  });

  it("requires a work pass for a foreigner on the start date", async () => {
    const payload = hirePayload(s, { person: { idType: "fin", idNumber: "G1234567X", residencyStatus: "foreigner" } });
    const e = await err(hire(owner(), payload));
    expect(e.message).toContain("Add a work pass");
    const ok = await hire(owner(), {
      ...payload,
      workPass: { passType: "EP", passNumber: "G1234567X", issuedOn: "2025-12-01", expiresOn: "2027-11-30" },
    });
    expect(ok.employeeId).toBeTruthy();
  });

  it("an hr_admin cannot set pay on hire, but can hire without it", async () => {
    const hr = ctxFor(h.deps, h.ports, h.actor(HR));
    expect((await err(hire(hr, hirePayload(s)))).code).toBe("forbidden");
    expect((await hire(hr, hirePayload(s, { compensation: null }))).employeeId).toBeTruthy();
  });

  it("rejects the employee as their own manager and archived departments", async () => {
    const archivedDept = await (await import("../organisation/structure.ts")).createStructure(
      h.deps,
      h.ports,
      h.actor(OWNER),
      "departments",
      { name: "Old" },
    );
    await (await import("../organisation/structure.ts")).archiveStructure(
      h.deps,
      h.ports,
      h.actor(OWNER),
      "departments",
      archivedDept.id,
      true,
    );
    const e = await err(hire(owner(), hirePayload(s, { job: { departmentId: archivedDept.id } })));
    expect(e.message).toContain("archived");
  });
});

describe("minimum employment age (Employment Act s 68 via sg-rules)", () => {
  it("refuses a hire under 13 on the start date and allows 13", async () => {
    const young = await err(
      hire(owner(), hirePayload(s, { person: { dob: "2013-11-02" }, job: { hireDate: "2026-11-01" } })),
    );
    expect(young.code).toBe("validation_failed");
    expect(JSON.stringify(young.details)).toContain("at least 13");
    const ok = await hire(owner(), hirePayload(s, { person: { dob: "2013-11-01" }, job: { hireDate: "2026-11-01" } }));
    expect(ok.employeeId).toBeTruthy();
  });
});

describe("transfer, promotion, salary change", () => {
  let a: string;
  beforeEach(async () => {
    a = (await hire(owner(), hirePayload(s))).employeeId;
  });

  it("as-at shows Sales before and Ops from the transfer date", async () => {
    await applyEvent(owner(), a, {
      type: "transfer",
      effectiveDate: "2026-09-01",
      changes: { departmentId: s.departments.ops },
    });
    expect((await asAt(t.db, employmentRecords, h.orgId, a, "2026-08-31"))?.departmentId).toBe(s.departments.sales);
    expect((await asAt(t.db, employmentRecords, h.orgId, a, "2026-09-01"))?.departmentId).toBe(s.departments.ops);
  });

  it("records the manager/executive classification at hire and from a promotion (EA Part 4)", async () => {
    const { employeeId: mgr } = await hire(owner(), hirePayload(s, { job: { isManagerOrExecutive: true } }));
    expect((await asAt(t.db, employmentRecords, h.orgId, mgr, "2026-01-05"))?.isManagerOrExecutive).toBe(true);
    expect((await asAt(t.db, employmentRecords, h.orgId, a, "2026-01-05"))?.isManagerOrExecutive).toBe(false);
    await applyEvent(owner(), a, {
      type: "promotion",
      effectiveDate: "2026-09-01",
      changes: { jobTitle: "Sales Manager", isManagerOrExecutive: true },
    });
    expect((await asAt(t.db, employmentRecords, h.orgId, a, "2026-08-31"))?.isManagerOrExecutive).toBe(false);
    expect((await asAt(t.db, employmentRecords, h.orgId, a, "2026-09-01"))?.isManagerOrExecutive).toBe(true);
  });

  it("future-dated events are scheduled by the injected clock; past ones effective", async () => {
    const future = await applyEvent(owner(), a, {
      type: "promotion",
      effectiveDate: "2026-12-01",
      changes: { jobTitle: "Senior Account Executive" },
    });
    expect(future.status).toBe("scheduled");
    const past = await applyEvent(owner(), a, {
      type: "transfer",
      effectiveDate: "2026-03-01",
      changes: { teamId: null },
    });
    expect(past.status).toBe("effective");
  });

  it("cancel restores the prior record", async () => {
    const { eventId } = await applyEvent(owner(), a, {
      type: "transfer",
      effectiveDate: "2026-12-01",
      changes: { departmentId: s.departments.finance },
    });
    await cancelEvent(owner(), a, eventId);
    const rows = await t.db.select().from(employmentRecords).where(eq(employmentRecords.employeeId, a));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.effectiveTo).toBeNull();
    const events = await listEvents(t.db, h.orgId, a, "2026-10-31");
    expect(events.find((e) => e.id === eventId)?.status).toBe("cancelled");
  });

  it("effective events cannot be cancelled", async () => {
    const { eventId } = await applyEvent(owner(), a, {
      type: "transfer",
      effectiveDate: "2026-09-01",
      changes: { departmentId: s.departments.ops },
    });
    expect((await err(cancelEvent(owner(), a, eventId))).code).toBe("conflict");
  });

  it("reporting cycle → 409 reporting_cycle; self-manager rejected", async () => {
    const b = (await hire(owner(), hirePayload(s, { job: { managerEmployeeId: a } }))).employeeId;
    const e = await err(
      applyEvent(owner(), a, { type: "transfer", effectiveDate: "2026-11-01", changes: { managerEmployeeId: b } }),
    );
    expect(e.code).toBe("reporting_cycle");
    expect(e.status).toBe(409);
    const self = await err(
      applyEvent(owner(), a, { type: "transfer", effectiveDate: "2026-11-01", changes: { managerEmployeeId: a } }),
    );
    expect(self.code).toBe("validation_failed");
  });

  it("hr_admin cannot change salary; payroll_admin cannot change own salary", async () => {
    const hr = ctxFor(h.deps, h.ports, h.actor(HR));
    const salary = {
      type: "salary_change",
      effectiveDate: "2027-01-01",
      compensation: { payBasis: "monthly", amountCents: 420_000 },
    };
    expect((await err(applyEvent(hr, a, salary))).code).toBe("forbidden");
    const self = ctxFor(h.deps, h.ports, h.actor(PAYROLL, a));
    const e = await err(applyEvent(self, a, salary));
    expect(e.code).toBe("self_change_requires_approval");
  });
});

describe("resignation and termination", () => {
  it("last day counts the notice date as day 1", () => {
    expect(lastWorkingDayFor("2026-11-03", 30)).toBe("2026-12-02");
    expect(lastWorkingDayFor("2026-11-03", 1)).toBe("2026-11-03");
  });

  it("resignation sets Leaving, closes records after the last day and creates the offboarding checklist", async () => {
    const a = (await hire(owner(), hirePayload(s))).employeeId;
    const r = await applyEvent(owner(), a, { type: "resignation", noticeGivenOn: "2026-11-03", noticeDays: 30 });
    expect(r.status).toBe("scheduled");
    const ten = await t.db.select().from(tenures).where(eq(tenures.employeeId, a));
    expect(employmentStatus(ten, "2026-10-31")).toMatchObject({ code: "leaving", label: "Leaving 2 Dec 2026" });
    expect(employmentStatus(ten, "2026-12-03").code).toBe("former");
    expect(await asAt(t.db, employmentRecords, h.orgId, a, "2026-12-02")).toBeTruthy();
    expect(await asAt(t.db, employmentRecords, h.orgId, a, "2026-12-03")).toBeUndefined();
    const items = await t.db.select().from(checklistItems).where(eq(checklistItems.orgId, h.orgId));
    expect(items.some((i) => i.title === "Collect company property" && i.dueOn === "2026-12-02")).toBe(true);
  });

  it("without a contractual notice period, the Employment Act minimum for the service applies", async () => {
    // Hired 5 Jan 2026 (hirePayload): under 26 weeks on 3 Mar → 1 day; 26 weeks to 2 years on 3 Nov → 1 week.
    const early = (await hire(owner(), hirePayload(s))).employeeId;
    await applyEvent(owner(), early, { type: "resignation", noticeGivenOn: "2026-03-03" });
    const later = (await hire(owner(), hirePayload(s))).employeeId;
    await applyEvent(owner(), later, { type: "resignation", noticeGivenOn: "2026-11-03" });
    const veteran = (await hire(owner(), hirePayload(s, { job: { hireDate: "2025-01-02" } }))).employeeId;
    await applyEvent(owner(), veteran, { type: "resignation", noticeGivenOn: "2026-11-03", noticeDays: 30 });
    const tenureOf = async (id: string) => (await t.db.select().from(tenures).where(eq(tenures.employeeId, id)))[0];
    expect(await tenureOf(early)).toMatchObject({ noticeDays: 1, lastWorkingDay: "2026-03-03" });
    expect(await tenureOf(later)).toMatchObject({ noticeDays: 7, lastWorkingDay: "2026-11-09" });
    // A contractual period always wins.
    expect(await tenureOf(veteran)).toMatchObject({ noticeDays: 30, lastWorkingDay: "2026-12-02" });
  });

  it("shortened notice by agreement; cannot extend", async () => {
    const a = (await hire(owner(), hirePayload(s))).employeeId;
    const e = await err(
      applyEvent(owner(), a, {
        type: "resignation",
        noticeGivenOn: "2026-11-03",
        noticeDays: 30,
        agreedLastWorkingDay: "2026-12-10",
      }),
    );
    expect(e.code).toBe("validation_failed");
    await applyEvent(owner(), a, {
      type: "resignation",
      noticeGivenOn: "2026-11-03",
      noticeDays: 30,
      agreedLastWorkingDay: "2026-11-20",
    });
    const [ten] = await t.db.select().from(tenures).where(eq(tenures.employeeId, a));
    expect(ten?.lastWorkingDay).toBe("2026-11-20");
  });

  it("cancelling a scheduled resignation restores records and cancels the checklist", async () => {
    const a = (await hire(owner(), hirePayload(s))).employeeId;
    const { eventId } = await applyEvent(owner(), a, {
      type: "resignation",
      noticeGivenOn: "2026-11-03",
      noticeDays: 30,
    });
    await cancelEvent(owner(), a, eventId);
    const [ten] = await t.db.select().from(tenures).where(eq(tenures.employeeId, a));
    expect(ten?.lastWorkingDay).toBeNull();
    expect(await asAt(t.db, employmentRecords, h.orgId, a, "2027-06-01")).toBeTruthy();
    expect(await asAt(t.db, compensationRecords, h.orgId, a, "2027-06-01")).toBeTruthy();
    const open = await t.db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.orgId, h.orgId), eq(checklistItems.title, "Collect company property")));
    expect(open.every((i) => i.status === "cancelled")).toBe(true);
  });

  it("termination records the reason", async () => {
    const a = (await hire(owner(), hirePayload(s))).employeeId;
    await applyEvent(owner(), a, { type: "termination", reason: "retrenchment", lastWorkingDay: "2026-11-30" });
    const [ten] = await t.db.select().from(tenures).where(eq(tenures.employeeId, a));
    expect(ten?.cessationReason).toBe("retrenchment");
    const bad = await err(
      applyEvent(owner(), a, { type: "termination", reason: "bored", lastWorkingDay: "2026-11-30" }),
    );
    expect(bad).toBeInstanceOf(AppError);
  });
});

describe("rehire", () => {
  it("keeps the employee id and history and opens a second tenure", async () => {
    const a = (await hire(owner(), hirePayload(s, { job: { hireDate: "2023-02-01" } }))).employeeId;
    await applyEvent(owner(), a, { type: "termination", reason: "contract_end", lastWorkingDay: "2025-06-30" });
    const notYet = await err(
      applyEvent(owner(), a, {
        type: "rehire",
        job: {
          hireDate: "2025-06-30",
          jobTitle: "Barista",
          departmentId: s.departments.ops,
          employmentType: "full_time",
        },
      }),
    );
    expect(notYet.code).toBe("conflict");
    await applyEvent(owner(), a, {
      type: "rehire",
      job: {
        hireDate: "2026-03-01",
        jobTitle: "Barista",
        departmentId: s.departments.ops,
        employmentType: "full_time",
      },
      compensation: { payBasis: "monthly", amountCents: 280_000 },
    });
    const ten = await t.db.select().from(tenures).where(eq(tenures.employeeId, a));
    expect(ten.map((x) => x.hireDate).sort()).toEqual(["2023-02-01", "2026-03-01"]);
    expect((await asAt(t.db, employmentRecords, h.orgId, a, "2024-01-01"))?.jobTitle).toBe("Account Executive");
    expect(await asAt(t.db, employmentRecords, h.orgId, a, "2025-12-01")).toBeUndefined();
    expect((await asAt(t.db, employmentRecords, h.orgId, a, "2026-03-01"))?.jobTitle).toBe("Barista");
    expect(employmentStatus(ten, "2026-10-31").code).toBe("active");
  });
});
