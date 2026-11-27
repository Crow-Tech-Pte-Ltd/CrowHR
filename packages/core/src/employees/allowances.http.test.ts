import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import { createPeopleTestApp } from "../../testing/people-http.ts";
import { createPeopleHarness, hirePayload, seedBasicStructure } from "../testing/people-harness.ts";

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

async function setup() {
  const h = await createPeopleHarness(createTestDeps(db.db));
  const structure = await seedBasicStructure(h);
  const api = createPeopleTestApp(h.deps);
  const owner = api.as(h.orgId, ["owner"]);
  const payroll = api.as(h.orgId, ["payroll_admin"]);
  const type = await owner.post("/organisation/allowance-types", { code: "TRANSPORT", name: "Transport" });
  const other = await owner.post("/organisation/allowance-types", { code: "MEAL", name: "Meal" });
  expect(type.status).toBe(201);
  expect(other.status).toBe(201);
  const allowanceTypeId = type.body.id as string;
  const otherTypeId = other.body.id as string;
  const hired = await owner.post(
    "/employees",
    hirePayload(structure, {
      allowances: [
        { allowanceTypeId, amountCents: 12_000 },
        { allowanceTypeId: otherTypeId, amountCents: 8_000 },
      ],
    }),
  );
  expect(hired.status).toBe(201);
  const employeeId = hired.body.employeeId as string;
  const employeePath = `/employees/${employeeId}`;
  const eventPath = `${employeePath}/events`;
  const pay = async () => (await payroll.get(`${employeePath}/compensation`)).body;
  const stop = {
    type: "salary_change",
    effectiveDate: "2026-12-01",
    endAllowanceTypeIds: [allowanceTypeId],
  };
  const set = (effectiveDate: string, amountCents: number, requireSingleAllowanceRatePerMonth?: boolean) =>
    payroll.post(eventPath, {
      type: "salary_change",
      effectiveDate,
      allowances: [{ allowanceTypeId, amountCents }],
      requireSingleAllowanceRatePerMonth,
    });
  return { h, api, payroll, employeeId, employeePath, eventPath, allowanceTypeId, otherTypeId, pay, stop, set };
}

describe("effective-dated recurring allowance changes", () => {
  it("ends one allowance without writing basic pay or other allowances, and can cancel a scheduled end", async () => {
    const { payroll, eventPath, stop, pay, allowanceTypeId, otherTypeId } = await setup();
    const before = await pay();
    const ended = await payroll.post(eventPath, stop);
    expect(ended.status).toBe(201);
    expect(ended.body.status).toBe("scheduled");
    const after = await pay();
    expect(after.history).toEqual(before.history);
    expect(after.allowances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ allowanceTypeId, amountCents: 12_000, effectiveTo: "2026-12-01" }),
        expect.objectContaining({ allowanceTypeId: otherTypeId, amountCents: 8_000, effectiveTo: null }),
      ]),
    );
    expect(after.allowances).toHaveLength(2);
    expect((await payroll.post(`${eventPath}/${ended.body.eventId}/cancel`)).status).toBe(204);
    expect(await pay()).toEqual(before);
  });

  it("preserves a scheduled stop when editing earlier, and a later restart when cancelling the stop", async () => {
    const { payroll, eventPath, stop, set, pay, allowanceTypeId } = await setup();
    const ended = await payroll.post(eventPath, stop);
    expect(ended.status).toBe(201);
    expect((await set("2026-11-15", 17_000)).status).toBe(201);
    expect((await set("2027-01-01", 19_000)).status).toBe(201);
    const timeline = async () =>
      (await pay()).allowances.filter((a: { allowanceTypeId: string }) => a.allowanceTypeId === allowanceTypeId);
    expect(await timeline()).toMatchObject([
      { effectiveFrom: "2027-01-01", effectiveTo: null, amountCents: 19_000 },
      { effectiveFrom: "2026-11-15", effectiveTo: "2026-12-01", amountCents: 17_000 },
      { effectiveFrom: "2026-01-05", effectiveTo: "2026-11-15", amountCents: 12_000 },
    ]);
    expect((await payroll.post(`${eventPath}/${ended.body.eventId}/cancel`)).status).toBe(204);
    expect(await timeline()).toMatchObject([
      { effectiveFrom: "2027-01-01", effectiveTo: null },
      { effectiveFrom: "2026-11-15", effectiveTo: "2027-01-01" },
      { effectiveFrom: "2026-01-05", effectiveTo: "2026-11-15" },
    ]);
  });

  it("authorises stops on the server and refuses finalised, cross-organisation, or contradictory changes", async () => {
    const { h, api, payroll, employeeId, eventPath, stop, set, pay, allowanceTypeId } = await setup();
    const before = await pay();
    const org2 = await createPeopleHarness(h.deps);
    const other = api.as(org2.orgId, ["owner"]);
    const foreignType = await other.post("/organisation/allowance-types", { code: "CAR", name: "Car" });
    expect(foreignType.status).toBe(201);
    expect((await other.post(eventPath, stop)).status).toBe(404);
    expect((await api.as(h.orgId, ["hr_admin"]).post(eventPath, stop)).status).toBe(403);
    expect((await api.as(h.orgId, ["payroll_admin"], employeeId).post(eventPath, stop)).body.error.code).toBe(
      "self_change_requires_approval",
    );
    expect((await payroll.post(eventPath, { ...stop, endAllowanceTypeIds: [foreignType.body.id] })).status).toBe(400);
    expect(
      (
        await payroll.post(eventPath, {
          ...stop,
          allowances: [{ allowanceTypeId, amountCents: 100 }],
        })
      ).status,
    ).toBe(400);
    h.ports.payroll.finalise(h.orgId, "2026-09-30");
    expect((await payroll.post(eventPath, { ...stop, effectiveDate: "2026-09-15" })).body.error.message).toContain(
      "September 2026 payroll is finalised",
    );
    expect((await set("2026-09-15", 1_000, true)).body.error.message).toContain("September 2026 payroll is finalised");
    expect(await pay()).toEqual(before);
    expect((await set("2026-09-15", 1_000)).status).toBe(201);
  });

  it("optionally refuses two amount versions in the same month without changing existing API callers", async () => {
    const { payroll, eventPath, set, allowanceTypeId } = await setup();
    const changeFromTheWeb = (effectiveDate: string) =>
      payroll.post(eventPath, {
        type: "salary_change",
        effectiveDate,
        requireSingleAllowanceRatePerMonth: true,
        allowances: [{ allowanceTypeId, amountCents: 15_000 }],
      });
    const middle = await changeFromTheWeb("2026-12-15");
    expect(middle.status).toBe(400);
    expect(middle.body.error.message).toContain("Use the first day of a month");
    expect((await changeFromTheWeb("2026-12-01")).status).toBe(201);
    expect((await set("2027-01-15", 22_000)).status).toBe(201);
    expect((await changeFromTheWeb("2027-01-01")).body.error.message).toContain("Cancel the later change");
  });

  it("reopens the replacement in force at a cancelled termination, while preserving an independent stop", async () => {
    const { h, api, payroll, eventPath, allowanceTypeId, otherTypeId, pay, set } = await setup();
    const independent = await payroll.post(eventPath, {
      type: "salary_change",
      effectiveDate: "2026-12-15",
      endAllowanceTypeIds: [otherTypeId],
    });
    expect(independent.status).toBe(201);
    const owner = api.as(h.orgId, ["owner"]);
    const leaving = await owner.post(eventPath, {
      type: "termination",
      reason: "dismissal",
      lastWorkingDay: "2026-12-31",
    });
    expect(leaving.status).toBe(201);
    expect((await set("2026-12-01", 17_000, true)).status).toBe(201);
    expect((await pay()).allowances).toContainEqual(
      expect.objectContaining({ allowanceTypeId, effectiveFrom: "2026-12-01", effectiveTo: "2027-01-01" }),
    );
    expect((await owner.post(`${eventPath}/${leaving.body.eventId}/cancel`)).status).toBe(204);
    expect((await pay()).allowances).toMatchObject([
      { allowanceTypeId, effectiveFrom: "2026-12-01", effectiveTo: null },
      expect.objectContaining({ effectiveFrom: "2026-01-05" }),
      expect.objectContaining({ effectiveFrom: "2026-01-05" }),
    ]);
    expect((await pay()).allowances).toContainEqual(
      expect.objectContaining({ allowanceTypeId: otherTypeId, effectiveTo: "2026-12-15" }),
    );
  });

  it("reopens an allowance when the rate originally closed by the cancelled termination was itself cancelled", async () => {
    const { h, api, payroll, eventPath, allowanceTypeId, pay, set } = await setup();
    const guarded = await set("2026-12-01", 17_000, true);
    const owner = api.as(h.orgId, ["owner"]);
    const leaving = await owner.post(eventPath, {
      type: "termination",
      reason: "dismissal",
      lastWorkingDay: "2026-12-31",
    });
    expect([guarded.status, leaving.status]).toEqual([201, 201]);
    expect((await payroll.post(`${eventPath}/${guarded.body.eventId}/cancel`)).status).toBe(204);
    expect((await owner.post(`${eventPath}/${leaving.body.eventId}/cancel`)).status).toBe(204);
    expect((await pay()).allowances).toContainEqual(
      expect.objectContaining({ allowanceTypeId, effectiveFrom: "2026-01-05", effectiveTo: null }),
    );
  });

  it("refuses cancellation of guarded allowance changes once payroll finalises while retaining legacy cancellation", async () => {
    const { h, payroll, eventPath, stop, set, pay } = await setup();
    const ended = await payroll.post(eventPath, stop);
    const guarded = await set("2027-01-01", 17_000, true);
    const legacy = await set("2027-02-01", 18_000);
    expect([ended.status, guarded.status, legacy.status]).toEqual([201, 201, 201]);
    const before = await pay();
    h.ports.payroll.finalise(h.orgId, "2027-02-28");
    for (const event of [ended, guarded]) {
      const cancel = await payroll.post(`${eventPath}/${event.body.eventId}/cancel`);
      expect(cancel.status).toBe(400);
      expect(cancel.body.error.message).toContain("February 2027 payroll is finalised");
    }
    expect(await pay()).toEqual(before);
    expect((await payroll.post(`${eventPath}/${legacy.body.eventId}/cancel`)).status).toBe(204);
  });
});
