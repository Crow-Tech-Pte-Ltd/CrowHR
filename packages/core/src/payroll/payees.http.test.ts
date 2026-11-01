import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { notifications } from "../db/schema/notifications.ts";
import { payrollPayslips } from "../db/schema/payroll.ts";

/**
 * Review finding #10: the bank file pays the accounts snapshotted at compute. A bank change after
 * that makes the run stale: approval and the bank file refuse until the run is recomputed and
 * approved again. Admin bank changes need a recent sign-in and notify the employee.
 */

let t: TestDb;
let p: PayrollHttp<"A">;
const api = "/api/v1/payroll";
const accountTag = (xml: string) => xml.match(/<CdtrAcct>[\s\S]*?<\/CdtrAcct>/)?.[0] ?? "";

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(t, [
    {
      key: "A",
      name: "Daud bin Hassan",
      dob: "1985-08-08",
      residency: "citizen",
      hireDate: "2020-09-01",
      basicCents: 260_000,
    },
  ]);
  await p.ok(
    p.admin.put(`${api}/settings`, {
      debitBankBic: "DBSSSGSG",
      debitAccountNumber: "0720123456",
      debitAccountName: "Kopi Kaki Pte. Ltd.",
    }),
  );
  await p.ok(
    p.admin.post(`/api/v1/employees/${p.co.e.A}/bank-accounts`, {
      bankCode: "DBSSSGSG",
      accountNumber: "1111111111",
      holderName: "Daud bin Hassan",
      effectiveFrom: "2026-01-01",
    }),
    201,
  );
}, 60_000);
afterAll(() => t.close());

async function approve(runId: string) {
  await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
  await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
  return decideRun(p.owner, runId, "approved");
}

const redirect = (effectiveFrom: string, accountNumber = "9999999999") =>
  p.admin.post(`/api/v1/employees/${p.co.e.A}/bank-accounts`, {
    bankCode: "DBSSSGSG",
    accountNumber,
    holderName: "Mallory Mule",
    effectiveFrom,
  });

describe("payee bank accounts are fixed at compute", () => {
  it("a backdated change after approval can't redirect pay: the file refuses until re-approved", async () => {
    const runId = (
      await p.ok<{ id: string }>(
        p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
        201,
      )
    ).id;
    await p.ok(approve(runId));
    const before = await p.admin.get(`${api}/runs/${runId}/files/bank`);
    expect(before.status).toBe(200);
    expect(accountTag(await before.text())).toContain("1111111111");

    await p.ok(redirect("2026-10-01"), 201);
    const after = await p.admin.get(`${api}/runs/${runId}/files/bank`);
    expect(after.status).toBe(409);
    const body = (await after.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Daud bin Hassan");
    expect(body.error.message).not.toContain("9999");

    // Recompute and re-approve: the owner now approves the new account, and the file pays it.
    await p.ok(p.admin.post(`${api}/runs/${runId}/return-to-draft`, { reason: "New bank account" }));
    await p.ok(approve(runId));
    const reapproved = await p.admin.get(`${api}/runs/${runId}/files/bank`);
    expect(reapproved.status).toBe(200);
    expect(accountTag(await reapproved.text())).toContain("9999999999");
  });

  it("a change while the run is in review blocks approval and makes submit stale", async () => {
    const runId = (
      await p.ok<{ id: string }>(
        p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-11", payDate: "2026-11-27" }),
        201,
      )
    ).id;
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    await p.ok(redirect("2026-11-01", "8888888888"), 201);
    const decided = await decideRun(p.owner, runId, "approved");
    expect(decided.status).toBe(409);
    await p.ok(p.admin.post(`${api}/runs/${runId}/withdraw`));
    const stale = await p.admin.post(`${api}/runs/${runId}/submit`);
    expect(stale.status).toBe(409);
    await p.ok(approve(runId));
  });

  it("admin bank changes need a recent sign-in and notify the employee", async () => {
    const m = await seedMember(p.co.h.deps, p.co.h.orgId, { roles: ["payroll_admin"] });
    const stale = await clientAs(p.app, p.co.h.deps, m, { authenticatedAt: new Date("2020-01-01T00:00:00Z") });
    const res = await stale.post(`/api/v1/employees/${p.co.e.A}/bank-accounts`, {
      bankCode: "DBSSSGSG",
      accountNumber: "7777777777",
      holderName: "Daud bin Hassan",
      effectiveFrom: "2027-01-01",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("reauth_required");

    const employee = await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A });
    await p.ok(redirect("2027-02-01", "6666666666"), 201);
    const notes = await t.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientMembershipId, employee.membershipId));
    const bank = notes.filter((n) => n.title === "Your bank account for salary was changed");
    expect(bank).toHaveLength(1);
    expect(bank[0]?.kind).toBe("security_notice");
    expect(bank[0]?.body).toContain("6666");
  });
  it("downloads a payslip with a Unicode employee number using RFC 5987", async () => {
    const run = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs`, { kind: "regular", month: "2027-03", payDate: "2027-03-30" }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${run.id}/compute`));
    const [slip] = await t.db
      .update(payrollPayslips)
      .set({ employeeNumber: "员工-ரவி" })
      .where(eq(payrollPayslips.runId, run.id))
      .returning();
    if (!slip) throw new Error("Missing payslip");
    const res = await p.admin.get(`${api}/runs/${run.id}/payslips/${slip.id}/pdf`);
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
    expect(disposition).toContain("filename*=UTF-8''payslip-2027-03-%E5%91%98%E5%B7%A5-");
    expect(disposition).toContain('filename="payslip-2027-03-__-___.pdf"');
  });
});
