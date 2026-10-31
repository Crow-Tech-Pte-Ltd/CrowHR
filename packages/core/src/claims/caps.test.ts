import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaimsWorld, createClaimsWorld, decide, json, line, managerOnlyPolicy } from "../../testing/claims.ts";
import { periodOf } from "./caps.ts";

describe("claim caps", () => {
  let w: ClaimsWorld;
  let monthly: string;
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-10-31T02:00:00.000Z" });
    monthly = await w.type({ code: "MEALS", name: "Meals", category: "meals", capCents: 10_000, capPeriod: "monthly" });
    await managerOnlyPolicy(w);
  });
  afterEach(() => w.t.close());

  const post = async (lines: unknown[], who: "staff" | "other" = "staff") => {
    const res = await (await w.as(who)).post("/api/v1/claims", { lines, submit: true });
    return { status: res.status, body: await json(res) };
  };
  const approvedClaim = async (cents: number, date = "2026-10-15") => {
    const r = await post([line(monthly, { amountMinor: cents, expenseDate: date })]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await decide(w, "manager", r.body.id, "approve")).status).toBe(200);
    return r.body.id as string;
  };

  it("monthly cap: S$70 approved, S$40 submitted → 422 with cap, used, pending and remaining", async () => {
    await approvedClaim(7000);
    const r = await post([line(monthly, { amountMinor: 4000 })]);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("cap_exceeded");
    expect(r.body.error.details).toMatchObject({
      capCents: 10_000,
      usedCents: 7000,
      pendingCents: 0,
      remainingCents: 3000,
      claimCents: 4000,
      period: "monthly",
      periodLabel: "October 2026",
    });
    expect(r.body.error.message).toContain("cap of S$100.00: used S$70.00, pending S$0.00, remaining S$30.00");
    // The draft is kept so the employee can fix it.
    expect(r.body.error.details.draftId).toBeTruthy();
    // S$30 fits exactly.
    expect((await post([line(monthly, { amountMinor: 3000 })])).status).toBe(201);
  });

  it("counts by the expense date's calendar month in SGT, per employee", async () => {
    await approvedClaim(9000, "2026-10-01");
    // September is a different period; another employee has their own cap.
    expect((await post([line(monthly, { amountMinor: 9000, expenseDate: "2026-09-30" })])).status).toBe(201);
    expect((await post([line(monthly, { amountMinor: 9000 })], "other")).status).toBe(201);
    expect((await post([line(monthly, { amountMinor: 1001, expenseDate: "2026-10-31" })])).status).toBe(422);
    expect(periodOf("monthly", "2026-12-31")).toMatchObject({ from: "2026-12-01", to: "2027-01-01" });
    expect(periodOf("yearly", "2026-06-30")).toMatchObject({ from: "2026-01-01", to: "2027-01-01", label: "2026" });
  });

  it("submitted claims count as pending at submission", async () => {
    expect((await post([line(monthly, { amountMinor: 6000 })])).status).toBe(201);
    const r = await post([line(monthly, { amountMinor: 6000 })]);
    expect(r.status).toBe(422);
    expect(r.body.error.details).toMatchObject({ usedCents: 0, pendingCents: 6000, remainingCents: 4000 });
  });

  it("two concurrent submissions serialise on the lock: the second sees the first", async () => {
    // Two drafts of S$60 each, submitted at the same time.
    const staff = await w.as("staff");
    const a = await json(await staff.post("/api/v1/claims", { lines: [line(monthly, { amountMinor: 6000 })] }));
    const b = await json(await staff.post("/api/v1/claims", { lines: [line(monthly, { amountMinor: 6000 })] }));
    const results = await Promise.all([
      staff.post(`/api/v1/claims/${a.id}/submit`),
      staff.post(`/api/v1/claims/${b.id}/submit`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    const loser = await json(results.find((r) => r.status === 422) as Response);
    expect(loser.error.details).toMatchObject({ pendingCents: 6000, remainingCents: 4000 });
  });

  it("re-checked at approval: two S$60 claims submitted while each fit; approving the second fails", async () => {
    // Both fit when submitted because the first was a draft-only total until then: submit them on different days
    // with the cap raised, then lower it (the realistic path is a cap change or a withdrawn/resubmitted claim).
    const staff = await w.as("staff");
    await (await w.as("owner")).patch(`/api/v1/claims/types/${monthly}`, { capCents: 20_000 });
    const first = await json(
      await staff.post("/api/v1/claims", { lines: [line(monthly, { amountMinor: 6000 })], submit: true }),
    );
    const second = await json(
      await staff.post("/api/v1/claims", { lines: [line(monthly, { amountMinor: 6000 })], submit: true }),
    );
    await (await w.as("owner")).patch(`/api/v1/claims/types/${monthly}`, { capCents: 10_000 });
    expect((await decide(w, "manager", first.id, "approve")).status).toBe(200);
    const res = await decide(w, "manager", second.id, "approve");
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error).toMatchObject({ code: "cap_exceeded" });
    // At approval only approved/paid claims count.
    expect(body.error.details).toMatchObject({ usedCents: 6000, pendingCents: 0, remainingCents: 4000 });
    expect(body.error.message).toMatch(/reject the claim with this reason/);
    // The decision rolled back: still submitted, and the approver can reject it.
    expect((await json(await staff.get(`/api/v1/claims/${second.id}`))).status).toBe("submitted");
    expect((await decide(w, "manager", second.id, "reject", "Over the monthly meals cap")).status).toBe(200);
  });

  it("per-claim caps apply to the sum of the claim's lines of the type", async () => {
    const perClaim = await w.type({ code: "TAXI", name: "Taxi", capCents: 5000, capPeriod: "per_claim" });
    const two = [line(perClaim, { amountMinor: 3000 }), line(perClaim, { amountMinor: 2500 })];
    const r = await post(two);
    expect(r.status).toBe(422);
    expect(r.body.error.details).toMatchObject({ period: "per_claim", capCents: 5000, claimCents: 5500 });
    expect((await post([line(perClaim, { amountMinor: 3000 })])).status).toBe(201);
    expect((await post([line(perClaim, { amountMinor: 3000 })])).status).toBe(201);
  });

  it("yearly caps count paid claims as used", async () => {
    const dental = await w.type({
      code: "DENTAL",
      name: "Dental",
      category: "dental",
      capCents: 30_000,
      capPeriod: "yearly",
    });
    const r1 = await post([line(dental, { amountMinor: 25_000, expenseDate: "2026-08-20", merchant: "Q&M" })]);
    expect(r1.status).toBe(201);
    expect((await decide(w, "manager", r1.body.id, "approve")).status).toBe(200);
    const paid = await (await w.as("payroll")).post("/api/v1/claims/mark-paid", {
      claimIds: [r1.body.id],
      paidOn: "2026-10-31",
      reference: "FAST",
    });
    expect(paid.status).toBe(200);
    const r2 = await post([line(dental, { amountMinor: 6000, expenseDate: "2026-10-30", merchant: "Q&M" })]);
    expect(r2.status).toBe(422);
    expect(r2.body.error.details).toMatchObject({
      period: "yearly",
      periodLabel: "2026",
      usedCents: 25_000,
      remainingCents: 5000,
    });
    // Next year's expense starts a new period (allowed once it is no longer in the future).
    w.clock.set("2027-01-02T02:00:00.000Z");
    expect((await post([line(dental, { amountMinor: 6000, expenseDate: "2027-01-01", merchant: "Q&M" })])).status).toBe(
      201,
    );
  });

  it("the form shows remaining cap per type live (eligible-types)", async () => {
    await approvedClaim(7000);
    const staff = await w.as("staff");
    const { items } = await json(await staff.get("/api/v1/claims/eligible-types?date=2026-10-31"));
    const meals = items.find((t: { code: string }) => t.code === "MEALS");
    expect(meals.cap).toMatchObject({
      capCents: 10_000,
      usedCents: 7000,
      pendingCents: 0,
      remainingCents: 3000,
      periodLabel: "October 2026",
    });
    const sept = await json(await staff.get("/api/v1/claims/eligible-types?date=2026-09-10"));
    expect(sept.items.find((t: { code: string }) => t.code === "MEALS").cap.remainingCents).toBe(10_000);
  });
});
