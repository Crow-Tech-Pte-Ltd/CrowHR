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
import type { TestClient } from "../../testing/http.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { claims } from "../db/schema/claims.ts";
import { notifications } from "../db/schema/notifications.ts";
import { approvalRequests, approvalSteps } from "../db/schema/workflows.ts";
import { replacePolicies } from "../workflows/policies.ts";
import { primaryTypeCode } from "./service.ts";

describe("claims × workflows (SubjectAdapter)", () => {
  let w: ClaimsWorld;
  let transport: string;
  let staff: TestClient;
  beforeEach(async () => {
    w = await createClaimsWorld();
    transport = await w.type({ code: "TRANSPORT", name: "Transport", category: "transport" });
    staff = await w.as("staff");
  });
  afterEach(() => w.t.close());

  const submit = async (lines: unknown[]) => {
    const res = await staff.post("/api/v1/claims", { lines, submit: true });
    const body = await json(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    return body;
  };

  it("submitting creates a numbered claim and a `claim` request with amount and type code", async () => {
    const claim = await submit([line(transport, { amountMinor: 4560 })]);
    expect(claim).toMatchObject({ status: "submitted", claimNumber: "C-0001", totalCents: 4560 });
    const [req] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, claim.id));
    expect(req).toMatchObject({
      subjectType: "claim",
      status: "pending",
      attributes: { amountCents: 4560, typeCode: "TRANSPORT" },
      requesterEmployeeId: w.emp.staff,
      requesterMembershipId: w.m.staff.membershipId,
      title: "Transport claim",
    });
    // Built-in chain: manager, then hr_admin. The manager holds the first task.
    expect(await pendingTask(w, claim.id, w.m.manager.membershipId)).toBeDefined();
    expect((await submit([line(transport)])).claimNumber).toBe("C-0002");
  });

  it("an amount-threshold policy adds an owner step", async () => {
    await managerOnlyPolicy(w, [
      {
        name: "Over S$500",
        condition: { amountGte: 50_000 },
        priority: 10,
        steps: [{ approverRule: "manager" }, { approverRule: "role:owner" }],
      },
    ]);
    const small = await submit([line(transport, { amountMinor: 4000 })]);
    const big = await submit([line(transport, { amountMinor: 62_000, merchant: "SIA", description: "Flight" })]);
    const steps = async (claimId: string) => {
      const [req] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, claimId));
      return (
        await w.deps.db
          .select()
          .from(approvalSteps)
          .where(eq(approvalSteps.requestId, req?.id as string))
      )
        .map((s) => s.approverRule)
        .sort();
    };
    expect(await steps(small.id)).toEqual(["manager"]);
    expect(await steps(big.id)).toEqual(["manager", "role:owner"]);
    expect((await decide(w, "manager", big.id, "approve")).status).toBe(200);
    expect((await json(await staff.get(`/api/v1/claims/${big.id}`))).status).toBe("submitted");
    expect((await decide(w, "owner", big.id, "approve")).status).toBe(200);
    expect((await json(await staff.get(`/api/v1/claims/${big.id}`))).status).toBe("approved");
  });

  it("final approval sets approved, payout and the SGT approval date, and notifies the employee", async () => {
    await managerOnlyPolicy(w);
    const claim = await submit([line(transport, { amountMinor: 4560 })]);
    const res = await decide(w, "manager", claim.id, "approve");
    expect(res.status).toBe(200);
    const after = await json(await staff.get(`/api/v1/claims/${claim.id}`));
    expect(after).toMatchObject({ status: "approved", payoutMethod: "payroll", approvedOn: "2026-10-31" });
    const notes = await w.deps.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientMembershipId, w.m.staff.membershipId));
    expect(notes.map((n) => n.kind)).toContain("request_approved");
    expect(notes.find((n) => n.kind === "request_approved")?.link).toBe(`/claims/${claim.id}`);
  });

  it("payout is `outside` only when every type pays outside payroll; mixed → payroll", async () => {
    await managerOnlyPolicy(w);
    const fast = await w.type({ code: "ADVANCE", name: "Petty cash", defaultPayout: "outside" });
    const outside = await submit([line(fast)]);
    const mixed = await submit([line(fast), line(transport)]);
    await decide(w, "manager", outside.id, "approve");
    await decide(w, "manager", mixed.id, "approve");
    expect((await json(await staff.get(`/api/v1/claims/${outside.id}`))).payoutMethod).toBe("outside");
    expect((await json(await staff.get(`/api/v1/claims/${mixed.id}`))).payoutMethod).toBe("payroll");
  });

  it("rejection stores the comment", async () => {
    const claim = await submit([line(transport)]);
    expect((await decide(w, "manager", claim.id, "reject", "Personal trip, not claimable")).status).toBe(200);
    const after = await json(await staff.get(`/api/v1/claims/${claim.id}`));
    expect(after).toMatchObject({ status: "rejected", decisionComment: "Personal trip, not claimable" });
    expect(after.actions.copy).toBe(true);
  });

  it("the employee withdraws while submitted; the open task is closed", async () => {
    const claim = await submit([line(transport)]);
    const res = await staff.post(`/api/v1/claims/${claim.id}/withdraw`);
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("withdrawn");
    expect(await pendingTask(w, claim.id, w.m.manager.membershipId)).toBeUndefined();
    // Not twice, and not by someone else.
    expect((await staff.post(`/api/v1/claims/${claim.id}/withdraw`)).status).toBe(409);
    const other = await submit([line(transport)]);
    expect((await (await w.as("other")).post(`/api/v1/claims/${other.id}/withdraw`)).status).toBe(404);
  });

  it("copying a rejected claim makes a new draft with the same lines and receipts; the original is unchanged", async () => {
    const up = await json(await uploadAs(staff, pngBytes(1)));
    const claim = await submit([line(transport, { receiptIds: [up.id] }), line(transport, { amountMinor: 900 })]);
    await decide(w, "manager", claim.id, "reject", "Split per trip");
    const res = await staff.post(`/api/v1/claims/${claim.id}/copy`);
    expect(res.status).toBe(201);
    const copy = await json(res);
    expect(copy).toMatchObject({ status: "draft", claimNumber: null, copiedFromClaimId: claim.id, totalCents: 2750 });
    expect(copy.lines).toHaveLength(2);
    expect(copy.lines[0].receipts.map((r: { id: string }) => r.id)).toEqual([up.id]);
    const original = await json(await staff.get(`/api/v1/claims/${claim.id}`));
    expect(original).toMatchObject({ status: "rejected", claimNumber: "C-0001" });
    // An approved claim can't be copied.
    expect((await staff.post(`/api/v1/claims/${copy.id}/copy`)).status).toBe(409);
  });

  it("a submitted claim cannot be edited", async () => {
    const claim = await submit([line(transport)]);
    const res = await staff.put(`/api/v1/claims/${claim.id}`, { lines: [line(transport, { amountMinor: 1 })] });
    expect(res.status).toBe(409);
    expect((await json(res)).error.message).toMatch(/Withdraw it first/);
  });

  it("the manager (approver) sees the claim and its receipts; another employee gets 404", async () => {
    const up = await json(await uploadAs(staff, pngBytes(2)));
    const claim = await submit([line(transport, { receiptIds: [up.id] })]);
    const asManager = await w.as("manager");
    const seen = await json(await asManager.get(`/api/v1/claims/${claim.id}`));
    expect(seen.lines[0].receipts).toHaveLength(1);
    expect((await asManager.get(`/api/v1/claims/receipts/${up.id}`)).status).toBe(200);
    expect((await (await w.as("other")).get(`/api/v1/claims/${claim.id}`)).status).toBe(404);
  });

  it("primary type code = largest type by amount, first on a tie", () => {
    expect(
      primaryTypeCode([
        { typeCode: "A", sgdCents: 100 },
        { typeCode: "B", sgdCents: 150 },
        { typeCode: "A", sgdCents: 60 },
      ]),
    ).toBe("A");
    expect(
      primaryTypeCode([
        { typeCode: "A", sgdCents: 100 },
        { typeCode: "B", sgdCents: 100 },
      ]),
    ).toBe("A");
  });

  it("the claims list shows the approver their task", async () => {
    const claim = await submit([line(transport)]);
    const list = await json(await (await w.as("manager")).get("/api/v1/claims?status=submitted"));
    expect(list.items.map((i: { id: string; approverTask: boolean }) => [i.id, i.approverTask])).toEqual([
      [claim.id, true],
    ]);
    const [row] = await w.deps.db.select().from(claims).where(eq(claims.id, claim.id));
    expect(row?.approvalRequestId).toBeTruthy();
  });

  it("an approver whose task was withdrawn no longer lists the claim (as they can't open it)", async () => {
    // A colleague outside the claimant's team approves claims, by name.
    await replacePolicies(w.deps.db, w.deps, systemAuditContext(w.orgId, "system", "test"), w.orgId, "claim", [
      {
        name: "Colleague",
        condition: null,
        priority: 0,
        steps: [{ approverRule: `member:${w.m.other.membershipId}`, escalateAfterDays: 3 }],
      },
    ]);
    const claim = await submit([line(transport)]);
    const other = await w.as("other");
    const ids = async () => (await json(await other.get("/api/v1/claims"))).items.map((i: { id: string }) => i.id);
    expect(await ids()).toContain(claim.id);
    expect((await staff.post(`/api/v1/claims/${claim.id}/withdraw`)).status).toBe(200);
    expect((await other.get(`/api/v1/claims/${claim.id}`)).status).toBe(404);
    expect(await ids()).not.toContain(claim.id);
  });
});
