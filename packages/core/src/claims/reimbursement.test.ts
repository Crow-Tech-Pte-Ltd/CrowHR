import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaimsWorld, createClaimsWorld, decide, json, line, managerOnlyPolicy } from "../../testing/claims.ts";
import { seedOrg } from "../../testing/fixtures.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { claims } from "../db/schema/claims.ts";
import { createClaimsReimbursementSource, type ReimbursementSource } from "./reimbursement.ts";

const RUN_OCT = "0192f0c0-0000-7000-8000-00000000a001";
const RUN_NOV = "0192f0c0-0000-7000-8000-00000000a002";
const RUN_OFF = "0192f0c0-0000-7000-8000-00000000a003";

describe("ReimbursementSource (claims → payroll)", () => {
  let w: ClaimsWorld;
  let source: ReimbursementSource;
  let transport: string;
  let meals: string;

  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-10-30T02:00:00.000Z" });
    source = createClaimsReimbursementSource(w.deps);
    transport = await w.type({ code: "TRANSPORT", name: "Transport" });
    meals = await w.type({ code: "MEALS", name: "Meals", category: "meals" });
    await managerOnlyPolicy(w);
  });
  afterEach(() => w.t.close());

  /** Staff submits; manager approves at the clock's current time. */
  const approved = async (lines: unknown[], who: "staff" | "other" = "staff") => {
    const res = await (await w.as(who)).post("/api/v1/claims", { lines, submit: true });
    const claim = await json(res);
    expect(res.status, JSON.stringify(claim)).toBe(201);
    expect((await decide(w, "manager", claim.id, "approve")).status).toBe(200);
    return claim as { id: string; claimNumber: string };
  };
  const row = async (id: string) => (await w.deps.db.select().from(claims).where(eq(claims.id, id)))[0];

  it("lists approved, unpaid payroll claims approved on or before the period end, one entry per type", async () => {
    const a = await approved([
      line(transport, { amountMinor: 4560 }),
      line(meals, { amountMinor: 1200 }),
      line(transport, { amountMinor: 440 }),
    ]);
    const b = await approved([line(meals, { amountMinor: 900 })], "other");
    // Not payable: still submitted; paid outside payroll type.
    await (await w.as("staff")).post("/api/v1/claims", { lines: [line(transport)], submit: true });
    const outsideType = await w.type({ code: "ADVANCE", name: "Advance", defaultPayout: "outside" });
    await approved([line(outsideType)]);

    const payable = await source.listPayable(w.orgId, "2026-10-31");
    expect(payable).toEqual(
      expect.arrayContaining([
        { claimId: a.id, employeeId: w.emp.staff, typeName: "Transport", taxable: false, amountCents: 5000 },
        { claimId: a.id, employeeId: w.emp.staff, typeName: "Meals", taxable: false, amountCents: 1200 },
        { claimId: b.id, employeeId: w.emp.other, typeName: "Meals", taxable: false, amountCents: 900 },
      ]),
    );
    expect(payable).toHaveLength(3);
    // Another organisation's period lists nothing of this one.
    const other = await seedOrg(w.deps);
    expect(await source.listPayable(other.id, "2026-10-31")).toEqual([]);
  });

  it("payroll admins see the period's payable claims over HTTP; others can't", async () => {
    const a = await approved([line(transport, { amountMinor: 4560 })]);
    const res = await (await w.as("payroll")).get("/api/v1/claims/payable?periodEnd=2026-10-31");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      items: [
        {
          claimId: a.id,
          employeeId: w.emp.staff,
          typeName: "Transport",
          amountCents: 4560,
          claimNumber: "C-0001",
          employeeName: "Ravi Kumar",
          approvedOn: "2026-10-30",
          reserved: false,
        },
      ],
      totalCents: 4560,
    });
    expect((await (await w.as("hr")).get("/api/v1/claims/payable?periodEnd=2026-10-31")).status).toBe(403);
    expect(
      (await json(await (await w.as("payroll")).get("/api/v1/claims/payable?periodEnd=2026-10-29"))).items,
    ).toEqual([]);
  });

  it("a claim approved after the cutoff rolls to the next run (approval date in SGT)", async () => {
    // 31 Oct 23:30 SGT = 31 Oct 15:30 UTC → still October.
    w.clock.set("2026-10-31T15:30:00.000Z");
    const lateOct = await approved([line(transport, { expenseDate: "2026-10-30" })]);
    // 1 Nov 00:30 SGT = 31 Oct 16:30 UTC → November, although UTC still says 31 Oct.
    w.clock.set("2026-10-31T16:30:00.000Z");
    const nov = await approved([line(transport, { expenseDate: "2026-10-31", amountMinor: 700 })]);
    expect((await row(nov.id))?.approvedOn).toBe("2026-11-01");

    const october = (await source.listPayable(w.orgId, "2026-10-31")).map((p) => p.claimId);
    expect(october).toEqual([lateOct.id]);
    const november = (await source.listPayable(w.orgId, "2026-11-30")).map((p) => p.claimId).sort();
    expect(november).toEqual([lateOct.id, nov.id].sort());
  });

  it("a claim approved after the October run was computed is not paid with it and is listed for November", async () => {
    const early = await approved([line(transport)]);
    // October run computes: lists and reserves.
    const listed = await source.listPayable(w.orgId, "2026-10-31");
    await w.deps.db.transaction((tx) =>
      source.reserve(
        tx,
        w.orgId,
        RUN_OCT,
        listed.map((p) => p.claimId),
      ),
    );
    // Approved on 30 Oct, before the cutoff, but after the run reserved its claims.
    w.clock.set("2026-10-30T03:00:00.000Z");
    const racer = await approved([line(transport, { amountMinor: 3300 })]);
    // October run is paid.
    await w.deps.db.transaction((tx) => source.markPaid(tx, w.orgId, RUN_OCT, "2026-10-31"));
    expect((await row(early.id))?.status).toBe("paid");
    expect(await row(racer.id)).toMatchObject({ status: "approved", payrollRunId: null });
    expect((await source.listPayable(w.orgId, "2026-11-30")).map((p) => p.claimId)).toEqual([racer.id]);
  });

  it("reserve excludes a claim from other runs; double reserve by another run fails; release frees it", async () => {
    const a = await approved([line(transport)]);
    await w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_OCT, [a.id, a.id]));
    expect((await row(a.id))?.payrollRunId).toBe(RUN_OCT);
    // Recomputing the same run: release + reserve again is fine.
    await w.deps.db.transaction(async (tx) => {
      await source.release(tx, w.orgId, RUN_OCT);
      await source.reserve(tx, w.orgId, RUN_OCT, [a.id]);
    });
    // Another run cannot take it.
    await expect(w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_OFF, [a.id]))).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("C-0001 is in another payroll run"),
    });
    // With the run ID, other runs don't even list it.
    const withRun = createClaimsReimbursementSource(w.deps) as ReimbursementSource & {
      listPayable(o: string, p: string, x?: { runId?: string }): ReturnType<ReimbursementSource["listPayable"]>;
    };
    expect(await withRun.listPayable(w.orgId, "2026-10-31", { runId: RUN_OFF })).toEqual([]);
    expect(await withRun.listPayable(w.orgId, "2026-10-31", { runId: RUN_OCT })).toHaveLength(1);
    // Discarding the run releases it.
    await w.deps.db.transaction((tx) => source.release(tx, w.orgId, RUN_OCT));
    expect((await row(a.id))?.payrollRunId).toBeNull();
    await w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_OFF, [a.id]));
    expect((await row(a.id))?.payrollRunId).toBe(RUN_OFF);
  });

  it("a discarded run that reserved 3 claims makes them payable again", async () => {
    const ids = [
      (await approved([line(transport)])).id,
      (await approved([line(meals)])).id,
      (await approved([line(transport)], "other")).id,
    ];
    await w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_OCT, ids));
    await w.deps.db.transaction((tx) => source.release(tx, w.orgId, RUN_OCT));
    for (const id of ids) expect((await row(id))?.payrollRunId).toBeNull();
    await w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_NOV, ids));
  });

  it("markPaid sets the run's payment date and is idempotent: never paid twice, first date kept", async () => {
    const a = await approved([line(transport)]);
    await w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_OCT, [a.id]));
    await w.deps.db.transaction((tx) => source.markPaid(tx, w.orgId, RUN_OCT, "2026-10-31"));
    await w.deps.db.transaction((tx) => source.markPaid(tx, w.orgId, RUN_OCT, "2026-11-02"));
    expect(await row(a.id)).toMatchObject({
      status: "paid",
      paidVia: "payroll",
      paidOn: "2026-10-31",
      payrollRunId: RUN_OCT,
    });
    const audits = (await w.deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, a.id))).filter(
      (e) => e.action === "claim.paid",
    );
    expect(audits).toHaveLength(1);
    // Paid claims are no longer payable and cannot be reserved again, by any run.
    expect(await source.listPayable(w.orgId, "2026-12-31")).toEqual([]);
    await expect(w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_NOV, [a.id]))).rejects.toMatchObject({
      message: expect.stringContaining("already paid"),
    });
    // Releasing a paid run does not un-pay its claims.
    await w.deps.db.transaction((tx) => source.release(tx, w.orgId, RUN_OCT));
    expect(await row(a.id)).toMatchObject({ status: "paid", payrollRunId: RUN_OCT });
    // Visible to the employee.
    const mine = await json(await (await w.as("staff")).get(`/api/v1/claims/${a.id}`));
    expect(mine).toMatchObject({ status: "paid", paidVia: "payroll", paidOn: "2026-10-31" });
  });

  it("a failing payroll transaction rolls the payment back (markPaid runs in payroll's transaction)", async () => {
    const a = await approved([line(transport)]);
    await w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_OCT, [a.id]));
    await expect(
      w.deps.db.transaction(async (tx) => {
        await source.markPaid(tx, w.orgId, RUN_OCT, "2026-10-31");
        throw new Error("payroll failed after marking claims");
      }),
    ).rejects.toThrow("payroll failed");
    expect((await row(a.id))?.status).toBe("approved");
  });

  it("refuses to reserve claims that are not approved, paid outside, or of another organisation", async () => {
    const res = await (await w.as("staff")).post("/api/v1/claims", { lines: [line(transport)], submit: true });
    const submitted = await json(res);
    await expect(
      w.deps.db.transaction((tx) => source.reserve(tx, w.orgId, RUN_OCT, [submitted.id])),
    ).rejects.toMatchObject({
      message: expect.stringContaining("submitted, not approved"),
    });
    const other = await createClaimsWorld();
    await expect(
      other.deps.db.transaction((tx) =>
        createClaimsReimbursementSource(other.deps).reserve(tx, other.orgId, RUN_OCT, [submitted.id]),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("doesn't exist"),
    });
    await other.t.close();
  });
});

describe("paid outside payroll", () => {
  let w: ClaimsWorld;
  let transport: string;
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-11-03T02:00:00.000Z" });
    transport = await w.type({ code: "TRANSPORT", name: "Transport" });
    await managerOnlyPolicy(w);
  });
  afterEach(() => w.t.close());

  const approved = async () => {
    const claim = await json(
      await (await w.as("staff")).post("/api/v1/claims", {
        lines: [line(transport, { expenseDate: "2026-11-02" })],
        submit: true,
      }),
    );
    await decide(w, "manager", claim.id, "approve");
    return claim.id as string;
  };

  it("a payroll_admin bulk-marks 5 claims paid with a reference; each is audited and none are payable", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await approved());
    const res = await (await w.as("payroll")).post("/api/v1/claims/mark-paid", {
      claimIds: ids,
      paidOn: "2026-11-04",
      reference: "FAST 4 Nov",
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ paid: 5 });
    for (const id of ids) {
      const [r] = await w.deps.db.select().from(claims).where(eq(claims.id, id));
      expect(r).toMatchObject({
        status: "paid",
        paidVia: "outside",
        paidOn: "2026-11-04",
        paidReference: "FAST 4 Nov",
      });
      const events = (await w.deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, id))).filter(
        (e) => e.action === "claim.paid",
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.meta).toMatchObject({ via: "outside", reference: "FAST 4 Nov" });
    }
    expect(await createClaimsReimbursementSource(w.deps).listPayable(w.orgId, "2026-11-30")).toEqual([]);
  });

  it("only payroll_admins and owners may do it", async () => {
    const id = await approved();
    const body = { claimIds: [id], paidOn: "2026-11-04", reference: "FAST" };
    for (const who of ["hr", "manager", "staff"] as const) {
      expect((await (await w.as(who)).post("/api/v1/claims/mark-paid", body)).status, who).toBe(403);
    }
    expect((await (await w.as("owner")).post("/api/v1/claims/mark-paid", body)).status).toBe(200);
  });

  it("refuses the whole batch when one claim is reserved by a payroll run or not approved", async () => {
    const a = await approved();
    const b = await approved();
    await w.deps.db.transaction((tx) => createClaimsReimbursementSource(w.deps).reserve(tx, w.orgId, RUN_NOV, [b]));
    const res = await (await w.as("payroll")).post("/api/v1/claims/mark-paid", {
      claimIds: [a, b],
      paidOn: "2026-11-04",
      reference: "FAST",
    });
    expect(res.status).toBe(409);
    expect((await json(res)).error.message).toMatch(/in a payroll run/);
    expect((await w.deps.db.select().from(claims).where(eq(claims.id, a)))[0]?.status).toBe("approved");
    // Validation: reference length.
    const bad = await (await w.as("payroll")).post("/api/v1/claims/mark-paid", {
      claimIds: [a],
      paidOn: "2026-11-04",
      reference: "x".repeat(101),
    });
    expect(bad.status).toBe(400);
    // Paying twice is refused.
    expect(
      (
        await (
          await w.as("payroll")
        ).post("/api/v1/claims/mark-paid", { claimIds: [a], paidOn: "2026-11-04", reference: "FAST" })
      ).status,
    ).toBe(200);
    expect(
      (
        await (
          await w.as("payroll")
        ).post("/api/v1/claims/mark-paid", { claimIds: [a], paidOn: "2026-11-05", reference: "FAST" })
      ).status,
    ).toBe(409);
  });

  it("another organisation's claim IDs answer 404", async () => {
    const id = await approved();
    const other = await createClaimsWorld();
    const res = await (await other.as("owner")).post("/api/v1/claims/mark-paid", {
      claimIds: [id],
      paidOn: "2026-11-04",
      reference: "FAST",
    });
    expect(res.status).toBe(404);
    await other.t.close();
  });
});
