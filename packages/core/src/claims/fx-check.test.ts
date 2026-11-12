import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ClaimsWorld,
  createClaimsWorld,
  decide,
  insertClaim,
  json,
  line,
  managerOnlyPolicy,
  seedOtherClaimsOrg,
} from "../../testing/claims.ts";
import type { TestClient } from "../../testing/http.ts";
import { deviationBasisPoints, exceedsFxThreshold, formatBasisPoints } from "./fx-check.ts";

describe("exchange-rate threshold (pure)", () => {
  it("warns only when more than 20% away, in either direction", () => {
    expect(exceedsFxThreshold(360_000, 300_000)).toBe(false);
    expect(exceedsFxThreshold(240_000, 300_000)).toBe(false);
    expect(exceedsFxThreshold(360_001, 300_000)).toBe(true);
    expect(exceedsFxThreshold(239_999, 300_000)).toBe(true);
    expect(exceedsFxThreshold(300_000, 300_000)).toBe(false);
    // Exact at any scale, with no floating point: 1.2 × 5 micros is exactly 6.
    expect(exceedsFxThreshold(6, 5)).toBe(false);
    expect(exceedsFxThreshold(7, 5)).toBe(true);
    expect(exceedsFxThreshold(Number.MAX_SAFE_INTEGER, 1)).toBe(true);
  });

  it("deviation in basis points: signed, magnitude rounded up, capped at a safe integer", () => {
    expect(deviationBasisPoints(360_000, 300_000)).toBe(2000);
    expect(deviationBasisPoints(360_001, 300_000)).toBe(2001);
    expect(deviationBasisPoints(239_999, 300_000)).toBe(-2001);
    expect(deviationBasisPoints(400_000, 300_000)).toBe(3334);
    expect(deviationBasisPoints(150_000, 300_000)).toBe(-5000);
    expect(deviationBasisPoints(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(formatBasisPoints(3334)).toBe("33.34%");
    expect(formatBasisPoints(-2001)).toBe("20.01%");
    expect(formatBasisPoints(5)).toBe("0.05%");
  });
});

describe("exchange-rate warning on claims (last rate used in the organisation)", () => {
  let w: ClaimsWorld;
  let transport: string;
  let staff: TestClient;
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-11-03T02:00:00.000Z" });
    transport = await w.type({ code: "TRANSPORT", name: "Transport" });
    await managerOnlyPolicy(w);
    staff = await w.as("staff");
  });
  afterEach(() => w.t.close());

  const myr = (rate: string, overrides: Record<string, unknown> = {}) =>
    line(transport, { currency: "MYR", amountMinor: 10_000, rate, ...overrides });

  /** Submits as `who` one minute after the previous submission, so submission times differ. */
  const submit = async (lines: unknown[], who: keyof ClaimsWorld["m"] = "staff") => {
    w.clock.advance(60_000);
    const res = await (await w.as(who)).post("/api/v1/claims", { lines, submit: true });
    const body = await json(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    return body;
  };
  const detail = async (id: string, who: keyof ClaimsWorld["m"] = "staff") =>
    json(await (await w.as(who)).get(`/api/v1/claims/${id}`));
  const warnings = async (id: string) => ((await detail(id)).lines as { fxWarning: unknown }[]).map((l) => l.fxWarning);
  const withdraw = async (id: string) =>
    expect((await (await w.as("staff")).post(`/api/v1/claims/${id}/withdraw`)).status).toBe(200);

  it("no earlier rate for the currency: no warning; SGD lines never warn", async () => {
    const first = await submit([myr("0.300000"), line(transport)]);
    expect(await warnings(first.id)).toEqual([null, null]);
  });

  it("boundaries against the last rate used: exactly 20% up or down is fine, just over warns", async () => {
    const ref = await submit([myr("0.300000")]);
    await decide(w, "manager", ref.id, "approve");
    for (const rate of ["0.360000", "0.240000"]) {
      const c = await submit([myr(rate)]);
      expect(await warnings(c.id)).toEqual([null]);
      // Withdrawn claims don't count, so the next claim is compared with 0.300000 again.
      await withdraw(c.id);
    }
    const up = await submit([myr("0.360001")]);
    expect(await warnings(up.id)).toEqual([
      { lastRate: "0.300000", lastRateOn: "2026-11-03", deviationBasisPoints: 2001 },
    ]);
    await withdraw(up.id);
    const down = await submit([myr("0.239999")]);
    expect(await warnings(down.id)).toEqual([
      { lastRate: "0.300000", lastRateOn: "2026-11-03", deviationBasisPoints: -2001 },
    ]);
  });

  it("the approver sees it in the approval summary, and it doesn't block approval", async () => {
    await submit([myr("0.300000")]);
    const c = await submit([line(transport), myr("0.400000", { merchant: "Restoran Hua Mui" })]);
    const request = await json(await (await w.as("manager")).get(`/api/v1/approvals/requests/${c.approvalRequestId}`));
    expect(JSON.stringify(request)).toContain(
      "MYR 0.400000 is 33.34% above the last MYR rate used, 0.300000 on 3 Nov 2026.",
    );
    expect((await detail(c.id, "manager")).lines[1].fxWarning).toMatchObject({ deviationBasisPoints: 3334 });
    expect((await decide(w, "manager", c.id, "approve")).status).toBe(200);
    expect((await detail(c.id)).status).toBe("approved");
  });

  it("drafts, rejected claims and other lines of the same claim are not the last rate used", async () => {
    await submit([myr("0.300000")]);
    w.clock.advance(60_000);
    await staff.post("/api/v1/claims", { lines: [myr("0.900000")] }); // a draft
    const rejected = await submit([myr("0.900000")]);
    expect((await decide(w, "manager", rejected.id, "reject", "Wrong rate")).status).toBe(200);
    // 0.310000 is within 20% of 0.300000 (not of the rejected 0.900000); 0.500000 is compared with
    // 0.300000 too, never with the 0.310000 on its own claim.
    const c = await submit([myr("0.310000"), myr("0.500000")]);
    expect(await warnings(c.id)).toEqual([
      null,
      { lastRate: "0.300000", lastRateOn: "2026-11-03", deviationBasisPoints: 6667 },
    ]);
  });

  it("the most recent by submission time before this claim, not by creation", async () => {
    // Drafted first, submitted last.
    const early = await json(await staff.post("/api/v1/claims", { lines: [myr("0.300000")] }));
    const b = await submit([myr("0.500000")]);
    w.clock.advance(60_000);
    expect((await staff.post(`/api/v1/claims/${early.id}/submit`)).status).toBe(200);
    // b had no earlier rate; `early` compares with b's 0.500000 (submitted before it).
    expect(await warnings(b.id)).toEqual([null]);
    expect(await warnings(early.id)).toEqual([
      { lastRate: "0.500000", lastRateOn: "2026-11-03", deviationBasisPoints: -4000 },
    ]);
    // A new claim compares with `early` (0.300000), the most recently submitted.
    const c = await submit([myr("0.500000")]);
    expect(await warnings(c.id)).toEqual([
      { lastRate: "0.300000", lastRateOn: "2026-11-03", deviationBasisPoints: 6667 },
    ]);
  });

  it("among lines of the last claim, its last line in that currency counts", async () => {
    await submit([myr("0.300000"), myr("0.900000")]);
    const c = await submit([myr("0.900000")]);
    expect(await warnings(c.id)).toEqual([null]);
  });

  it("another organisation's rates are ignored", async () => {
    const other = await seedOtherClaimsOrg(w);
    // Teh Tarik Trading approved MYR at 0.900000 a minute before; Kopi Kaki's last rate is 0.300000.
    await submit([myr("0.300000")]);
    await insertClaim(w.deps, other, {
      status: "approved",
      submittedAt: new Date(w.clock.now().getTime() + 30_000),
      lines: [{ currency: "MYR", amountMinor: 10_000, rateMicros: 900_000, sgdCents: 9000 }],
    });
    const c = await submit([myr("0.310000")]);
    expect(await warnings(c.id)).toEqual([null]);
    const far = await submit([myr("0.900000")]);
    expect(await warnings(far.id)).toEqual([
      { lastRate: "0.310000", lastRateOn: "2026-11-03", deviationBasisPoints: 19_033 },
    ]);
  });
});
