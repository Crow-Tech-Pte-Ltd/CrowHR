import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaimsWorld, createClaimsWorld, json, line, pngBytes, uploadAs } from "../../testing/claims.ts";

describe("claim drafts and submission validation", () => {
  let w: ClaimsWorld;
  let always: string;
  let above: string;
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-10-31T02:00:00.000Z" });
    always = await w.type({
      code: "ENTERTAINMENT",
      name: "Client entertainment",
      category: "entertainment",
      receiptRule: "always",
    });
    above = await w.type({ code: "TRANSPORT", name: "Transport", receiptRule: "above", receiptAboveCents: 2000 });
  });
  afterEach(() => w.t.close());

  const submitNew = async (lines: unknown[]) => {
    const res = await (await w.as("staff")).post("/api/v1/claims", { lines, submit: true });
    return { status: res.status, body: await json(res) };
  };
  const issuesOf = (body: { error: { details?: { issues?: { path: string; message: string }[] } } }) =>
    body.error.details?.issues ?? [];

  it("a total too large to store, or a line worth S$0.00 after conversion, is a 400 that says what to fix", async () => {
    const huge = await submitNew([
      line(above, { amountMinor: Number.MAX_SAFE_INTEGER, receiptIds: [] }),
      line(above, { amountMinor: Number.MAX_SAFE_INTEGER, receiptIds: [] }),
    ]);
    expect(huge.status).toBe(400);
    expect(issuesOf(huge.body).map((i) => i.path)).toContain("lines");
    expect(issuesOf(huge.body).find((i) => i.path === "lines")?.message).toMatch(/total is too large/);
    // VND 50 at 0.000053 SGD is S$0.00265, which rounds to S$0.00.
    const zero = await submitNew([line(above, { currency: "VND", amountMinor: 50, rate: "0.000053" })]);
    expect(zero.status).toBe(400);
    expect(issuesOf(zero.body)).toEqual([
      { path: "lines.0.amountMinor", message: expect.stringMatching(/Line 1: .*S\$0\.00.*Check the amount and rate/) },
    ]);
  });

  it("1 to 30 lines", async () => {
    expect((await submitNew([])).status).toBe(400);
    const many = Array.from({ length: 31 }, () => line(above, { amountMinor: 100 }));
    expect((await submitNew(many)).status).toBe(400);
    expect((await submitNew(many.slice(0, 30))).status).toBe(201);
  });

  it("description 1–200 characters and a merchant are required on submit, not for drafts", async () => {
    const staff = await w.as("staff");
    const draft = await staff.post("/api/v1/claims", { lines: [line(above, { description: "", merchant: "" })] });
    expect(draft.status).toBe(201);
    const id = (await json(draft)).id;
    const res = await staff.post(`/api/v1/claims/${id}/submit`);
    expect(res.status).toBe(400);
    const paths = issuesOf(await json(res))
      .map((i) => i.path)
      .sort();
    expect(paths).toEqual(["lines.0.description", "lines.0.merchant"]);
    expect((await submitNew([line(above, { description: "x".repeat(201) })])).status).toBe(400);
  });

  it("expense dates: not in the future, not older than the window (90 days by default)", async () => {
    const future = await submitNew([line(above, { expenseDate: "2026-11-01" })]);
    expect(issuesOf(future.body)[0]?.message).toMatch(/in the future/);
    const old = await submitNew([line(above), line(above, { expenseDate: "2026-07-03" })]);
    expect(old.status).toBe(400);
    expect(issuesOf(old.body)).toEqual([
      { path: "lines.1.expenseDate", message: "Line 2: expenses older than 90 days cannot be claimed." },
    ]);
    // Exactly 90 days ago is inside the window.
    expect((await submitNew([line(above, { expenseDate: "2026-08-02" })])).status).toBe(201);
    await (await w.as("hr")).put("/api/v1/claims/settings", { submissionWindowDays: 30 });
    expect((await submitNew([line(above, { expenseDate: "2026-09-15" })])).status).toBe(400);
  });

  it("receipt rules: always, and above an amount; drafts save without receipts", async () => {
    const r1 = await submitNew([line(always)]);
    expect(r1.status).toBe(400);
    expect(issuesOf(r1.body)[0]?.message).toMatch(/Client entertainment needs a receipt\. Attach/);
    expect((await submitNew([line(above, { amountMinor: 2000 })])).status).toBe(201);
    const r2 = await submitNew([line(above, { amountMinor: 2001 })]);
    expect(issuesOf(r2.body)[0]?.message).toMatch(/Transport needs a receipt above S\$20\.00/);
    const up = await json(await uploadAs(await w.as("staff"), pngBytes(3)));
    expect((await submitNew([line(always, { receiptIds: [up.id] })])).status).toBe(201);
    expect((await (await w.as("staff")).post("/api/v1/claims", { lines: [line(always)] })).status).toBe(201);
  });

  it("at most 5 receipts per line", async () => {
    const staff = await w.as("staff");
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await json(await uploadAs(staff, pngBytes(100 + i)))).id);
    expect((await staff.post("/api/v1/claims", { lines: [line(always, { receiptIds: ids })] })).status).toBe(400);
    expect(
      (await staff.post("/api/v1/claims", { lines: [line(always, { receiptIds: ids.slice(0, 5) })] })).status,
    ).toBe(201);
  });

  it("GST: at most the line amount; rejected on non-SGD lines and on types without GST", async () => {
    expect((await submitNew([line(above, { amountMinor: 1090, gstCents: 90 })])).status).toBe(201);
    const over = await submitNew([line(above, { amountMinor: 1000, gstCents: 1001 })]);
    expect(issuesOf(over.body)[0]?.path).toBe("lines.0.gstCents");
    const usd = await submitNew([line(above, { currency: "USD", rate: "1.35", amountMinor: 1000, gstCents: 50 })]);
    expect(usd.status).toBe(400);
    expect(issuesOf(usd.body)[0]?.message).toBe(
      "GST applies only to SGD expenses. Remove the GST amount for this line",
    );
    const noGst = await w.type({ code: "OVERSEAS", name: "Overseas per diem", gstApplicable: false });
    const r = await submitNew([line(noGst, { gstCents: 10 })]);
    expect(issuesOf(r.body)[0]?.message).toMatch(/doesn't take GST/);
  });

  it("foreign currency: rate required (≤ 6 dp), SGD computed with integer half-up rounding, shown to approvers", async () => {
    const noRate = await submitNew([line(above, { currency: "MYR", amountMinor: 12_550 })]);
    expect(issuesOf(noRate.body)[0]?.path).toBe("lines.0.rate");
    expect((await submitNew([line(above, { currency: "MYR", amountMinor: 12_550, rate: "0.3012345" })])).status).toBe(
      400,
    );
    expect((await submitNew([line(above, { currency: "XYZ", amountMinor: 100, rate: "1" })])).status).toBe(400);
    expect((await submitNew([line(above, { currency: "SGD", amountMinor: 100, rate: "1" })])).status).toBe(400);
    const up = await json(await uploadAs(await w.as("staff"), pngBytes(4)));
    const up2 = await json(await uploadAs(await w.as("staff"), pngBytes(5)));
    const ok = await submitNew([
      line(above, { currency: "MYR", amountMinor: 12_550, rate: "0.301234", receiptIds: [up.id] }),
      line(above, { currency: "jpy", amountMinor: 5000, rate: "0.008912", receiptIds: [up2.id] }),
    ]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(
      ok.body.lines.map((l: { currency: string; amountMinor: number; rate: string; sgdCents: number }) => [
        l.currency,
        l.amountMinor,
        l.rate,
        l.sgdCents,
      ]),
    ).toEqual([
      ["MYR", 12_550, "0.301234", 3780],
      ["JPY", 5000, "0.008912", 4456],
    ]);
    expect(ok.body.totalCents).toBe(8236);
    const summary = await json(
      await (await w.as("manager")).get(`/api/v1/approvals/requests/${ok.body.approvalRequestId}`),
    );
    expect(JSON.stringify(summary)).toContain("MYR 125.50 @ 0.301234");
  });

  it("drafts: edited and deleted only while draft, only by the claimant (or HR on behalf)", async () => {
    const staff = await w.as("staff");
    const d = await json(await staff.post("/api/v1/claims", { title: "October trips", lines: [line(above)] }));
    expect(d).toMatchObject({ status: "draft", title: "October trips", claimNumber: null });
    const put = await staff.put(`/api/v1/claims/${d.id}`, { lines: [line(above, { amountMinor: 999 }), line(above)] });
    expect((await json(put)).totalCents).toBe(2849);
    // Other people's drafts are invisible, even to HR and the manager.
    expect((await (await w.as("other")).get(`/api/v1/claims/${d.id}`)).status).toBe(404);
    expect((await (await w.as("manager")).get(`/api/v1/claims/${d.id}`)).status).toBe(404);
    expect((await (await w.as("hr")).get(`/api/v1/claims/${d.id}`)).status).toBe(404);
    expect((await (await w.as("other")).delete(`/api/v1/claims/${d.id}`)).status).toBe(404);
    expect((await staff.delete(`/api/v1/claims/${d.id}`)).status).toBe(204);
    expect((await staff.get(`/api/v1/claims/${d.id}`)).status).toBe(404);
  });

  it("HR submits on behalf of an employee; payroll_admin and managers can't create claims", async () => {
    const hr = await w.as("hr");
    const res = await hr.post("/api/v1/claims", { employeeId: w.emp.other, lines: [line(above)], submit: true });
    expect(res.status).toBe(201);
    expect((await json(res)).employee).toMatchObject({ id: w.emp.other, name: "Siti Rahmah", departmentName: "Sales" });
    expect(
      (await (await w.as("payroll")).post("/api/v1/claims", { employeeId: w.emp.other, lines: [line(above)] })).status,
    ).toBe(403);
    // A manager has no create permission on the team (only their own, as an employee).
    expect(
      (await (await w.as("manager")).post("/api/v1/claims", { employeeId: w.emp.staff, lines: [line(above)] })).status,
    ).toBe(404);
    // An employee who isn't in this organisation: the same 404 for HR, on every on-behalf route.
    const nobody = w.deps.ids.newId();
    const create = await hr.post("/api/v1/claims", { employeeId: nobody, lines: [line(above)] });
    expect([create.status, (await json(create)).error.message]).toEqual([
      404,
      "That employee doesn't exist or you can't claim for them.",
    ]);
    expect((await hr.get(`/api/v1/claims/eligible-types?employeeId=${nobody}`)).status).toBe(404);
    const upload = await uploadAs(hr, pngBytes(7), "receipt.png", `&employeeId=${nobody}`);
    expect([upload.status, (await json(upload)).error.message]).toEqual([
      404,
      "That employee doesn't exist or you can't claim for them.",
    ]);
  });

  it("list scope: own, team (manager), all (HR/payroll); `mine` is the caller's own", async () => {
    await submitNew([line(above)]);
    await (await w.as("other")).post("/api/v1/claims", { lines: [line(above)], submit: true });
    await (await w.as("boss")).post("/api/v1/claims", { lines: [line(above)], submit: true });
    const count = async (who: keyof ClaimsWorld["m"], q = "") =>
      (await json(await (await w.as(who)).get(`/api/v1/claims${q}`))).total;
    expect(await count("staff")).toBe(1);
    // The manager's team is staff, other and the intern; the boss is their own manager, not a report.
    expect(await count("manager")).toBe(2);
    expect(await count("payroll")).toBe(3);
    expect(await count("hr")).toBe(3);
    expect(await count("manager", "?mine=true")).toBe(0);
    expect(await count("boss", "?mine=true")).toBe(1);
  });
});
