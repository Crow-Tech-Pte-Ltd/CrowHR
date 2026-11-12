import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaimsWorld, createClaimsWorld, decide, json, line, managerOnlyPolicy } from "../../testing/claims.ts";
import { orgCounters } from "../db/schema/files.ts";

/**
 * Claim numbers are `C-` and at least four digits, so text order puts C-10000 before C-9999.
 * Every ordering by claim number goes by length, then text (close-claims-gaps "Claim number order").
 */
describe("claim numbers sort numerically across C-9999 → C-10000", () => {
  let w: ClaimsWorld;
  let transport: string;
  const ids: string[] = [];
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-11-03T02:00:00.000Z" });
    transport = await w.type({ code: "TRANSPORT", name: "Transport" });
    await managerOnlyPolicy(w);
    const staff = await w.as("staff");
    // The first claim takes C-0001 and creates the counter; then jump it to 9998.
    const first = await json(
      await staff.post("/api/v1/claims", { lines: [line(transport, { expenseDate: "2026-10-30" })], submit: true }),
    );
    expect(first.claimNumber).toBe("C-0001");
    await w.deps.db
      .update(orgCounters)
      .set({ nextValue: 9998 })
      .where(and(eq(orgCounters.orgId, w.orgId), eq(orgCounters.name, "claim_number")));
    ids.length = 0;
    ids.push(first.id);
    for (let i = 0; i < 3; i++) {
      const c = await json(
        await staff.post("/api/v1/claims", {
          lines: [line(transport, { expenseDate: "2026-10-30", amountMinor: 1000 + i })],
          submit: true,
        }),
      );
      ids.push(c.id);
    }
    // A draft has no number: it sorts last both ways.
    await staff.post("/api/v1/claims", { lines: [line(transport)] });
  });
  afterEach(() => w.t.close());

  it("the list API sorts by claimNumber ascending and descending, drafts last", async () => {
    const staff = await w.as("staff");
    const numbers = async (sort: string) =>
      (
        (await json(await staff.get(`/api/v1/claims?mine=true&sort=${sort}`))).items as { claimNumber: string | null }[]
      ).map((c) => c.claimNumber);
    expect(await numbers("claimNumber")).toEqual(["C-0001", "C-9998", "C-9999", "C-10000", null]);
    expect(await numbers("-claimNumber")).toEqual(["C-10000", "C-9999", "C-9998", "C-0001", null]);
  });

  it("the line register and the payout register order claims numerically within a date", async () => {
    // Approve and pay all four outside payroll on the same day.
    for (const id of ids) {
      const res = await decide(w, "manager", id, "approve");
      expect(res.status).toBe(200);
    }
    const paid = await (await w.as("payroll")).post("/api/v1/claims/mark-paid", {
      claimIds: ids,
      paidOn: "2026-11-03",
      reference: "FAST 3 Nov",
    });
    expect(paid.status).toBe(200);
    const hr = await w.as("hr");
    const csvClaims = (csv: string) =>
      csv
        .split("\r\n")
        .slice(1)
        .filter(Boolean)
        .map((row) => row.split(",")[0]);
    const lines = await (
      await hr.get("/api/v1/claims/reports/export?report=lines&from=2026-10-01&to=2026-10-31")
    ).text();
    expect(csvClaims(lines)).toEqual(["C-0001", "C-9998", "C-9999", "C-10000"]);
    const payouts = await (
      await hr.get("/api/v1/claims/reports/export?report=payouts&from=2026-11-01&to=2026-11-30")
    ).text();
    expect(csvClaims(payouts)).toEqual(["C-0001", "C-9998", "C-9999", "C-10000"]);
    // The reporting sources keep that order within a date too.
    const rows = async (id: string, q: string) =>
      ((await json(await hr.get(`/api/v1/reports/${id}${q}`))).rows as { claim: string }[]).map((r) => r.claim);
    expect(await rows("claims.lines", "?from=2026-10-01&to=2026-10-31")).toEqual([
      "C-0001",
      "C-9998",
      "C-9999",
      "C-10000",
    ]);
    expect(await rows("claims.payouts", "?from=2026-11-01&to=2026-11-30")).toEqual([
      "C-0001",
      "C-9998",
      "C-9999",
      "C-10000",
    ]);
  });
});
