import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ClaimsWorld,
  createClaimsWorld,
  decide,
  json,
  line,
  managerOnlyPolicy,
  pendingTask,
  pngBytes,
  uploadAs,
} from "../../testing/claims.ts";
import { files } from "../db/schema/files.ts";
import { approvalRequests } from "../db/schema/workflows.ts";

/**
 * Filing a claim for an employee (close-claims-gaps "Filing a claim for an employee"): the web
 * form passes `employeeId` to eligible-types, receipt upload and create. These pin the server
 * rule the form relies on: types, caps and receipts follow the chosen employee, and only
 * `claims:create` scope `all` (owners, hr_admins) may name someone else.
 */
describe("claims filed on behalf of an employee", () => {
  let w: ClaimsWorld;
  let meals: string;
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-10-31T02:00:00.000Z" });
    meals = await w.type({ code: "MEALS", name: "Meals", category: "meals", capPeriod: "monthly", capCents: 10_000 });
    await w.type({ code: "PHONE", name: "Mobile phone", category: "phone", eligibleEmploymentTypes: ["full_time"] });
    await w.type({ code: "TRAINING", name: "Training", category: "training", availableDuringProbation: false });
    await managerOnlyPolicy(w);
  });
  afterEach(() => w.t.close());

  const offered = async (who: keyof ClaimsWorld["m"], employeeId: string) => {
    const res = await (await w.as(who)).get(`/api/v1/claims/eligible-types?date=2026-10-31&employeeId=${employeeId}`);
    expect(res.status).toBe(200);
    return (await json(res)).items as { code: string; cap: { usedCents: number; remainingCents: number } | null }[];
  };

  it("eligible types and remaining caps are the chosen employee's", async () => {
    // Ravi has S$70.00 of approved meals this month; the intern has none.
    const staffClaim = await json(
      await (await w.as("staff")).post("/api/v1/claims", { lines: [line(meals, { amountMinor: 7000 })], submit: true }),
    );
    expect((await decide(w, "manager", staffClaim.id, "approve")).status).toBe(200);
    for (const who of ["hr", "owner"] as const) {
      const forStaff = await offered(who, w.emp.staff);
      expect(forStaff.map((t) => t.code)).toEqual(["MEALS", "PHONE", "TRAINING"]);
      expect(forStaff.find((t) => t.code === "MEALS")?.cap).toMatchObject({ usedCents: 7000, remainingCents: 3000 });
      // The intern (intern, on probation): no phone, no training, the full meals cap.
      const forIntern = await offered(who, w.emp.intern);
      expect(forIntern.map((t) => t.code)).toEqual(["MEALS"]);
      expect(forIntern[0]?.cap).toMatchObject({ usedCents: 0, remainingCents: 10_000 });
    }
  });

  it("HR uploads receipts as the employee's and files the claim; it goes to the employee's approver", async () => {
    const hr = await w.as("hr");
    const upload = await uploadAs(hr, pngBytes(11), "receipt.png", `&employeeId=${w.emp.staff}`);
    expect(upload.status).toBe(201);
    const receipt = await json(upload);
    const [row] = await w.deps.db.select().from(files).where(eq(files.id, receipt.id));
    expect(row).toMatchObject({ ownerEmployeeId: w.emp.staff, uploadedByMembershipId: w.m.hr.membershipId });
    const res = await hr.post("/api/v1/claims", {
      employeeId: w.emp.staff,
      lines: [line(meals, { amountMinor: 2500, receiptIds: [receipt.id] })],
      submit: true,
    });
    const claim = await json(res);
    expect(res.status, JSON.stringify(claim)).toBe(201);
    expect(claim).toMatchObject({ status: "submitted", employee: { id: w.emp.staff, name: "Ravi Kumar" } });
    expect(claim.lines[0].receipts.map((r: { id: string }) => r.id)).toEqual([receipt.id]);
    const [req] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, claim.id));
    expect(req).toMatchObject({ requesterEmployeeId: w.emp.staff, requesterMembershipId: w.m.staff.membershipId });
    expect(await pendingTask(w, claim.id, w.m.manager.membershipId)).toBeDefined();
    // The employee sees it in their own list, and may withdraw it.
    const mine = await json(await (await w.as("staff")).get("/api/v1/claims?mine=true"));
    expect(mine.items.map((c: { id: string }) => c.id)).toEqual([claim.id]);
  });

  it("a receipt uploaded for one employee can't go on another employee's claim", async () => {
    const hr = await w.as("hr");
    const forOther = await json(await uploadAs(hr, pngBytes(12), "receipt.png", `&employeeId=${w.emp.other}`));
    const res = await hr.post("/api/v1/claims", {
      employeeId: w.emp.staff,
      lines: [line(meals, { receiptIds: [forOther.id] })],
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error.details.issues).toEqual([
      { path: "lines.0.receiptIds", message: "Line 1: a receipt is missing. Upload it again." },
    ]);
  });

  it("a draft filed on behalf keeps its employee when edited", async () => {
    const hr = await w.as("hr");
    const draft = await json(await hr.post("/api/v1/claims", { employeeId: w.emp.intern, lines: [line(meals)] }));
    expect(draft).toMatchObject({ status: "draft", employee: { id: w.emp.intern }, actions: { edit: true } });
    // The edit form sends no employee; even one naming someone else doesn't move the draft.
    const put = await hr.put(`/api/v1/claims/${draft.id}`, {
      employeeId: w.emp.staff,
      lines: [line(meals, { amountMinor: 1234 })],
    });
    expect(put.status).toBe(200);
    expect(await json(put)).toMatchObject({ employee: { id: w.emp.intern }, totalCents: 1234 });
    const types = await json(
      await hr.get(`/api/v1/claims/eligible-types?employeeId=${w.emp.intern}&excludeClaimId=${draft.id}`),
    );
    expect(types.items.map((t: { code: string }) => t.code)).toEqual(["MEALS"]);
  });

  it("employees, managers and payroll admins can't name another employee anywhere", async () => {
    for (const [who, employeeId, status] of [
      ["staff", w.emp.other, 404],
      ["manager", w.emp.staff, 404],
      ["payroll", w.emp.staff, 403],
    ] as const) {
      const c = await w.as(who);
      expect((await c.get(`/api/v1/claims/eligible-types?employeeId=${employeeId}`)).status, who).toBe(status);
      expect((await uploadAs(c, pngBytes(13), "receipt.png", `&employeeId=${employeeId}`)).status, who).toBe(status);
      expect((await c.post("/api/v1/claims", { employeeId, lines: [line(meals)] })).status, who).toBe(status);
    }
  });
});
