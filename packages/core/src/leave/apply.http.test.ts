import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { approvalRequests } from "../db/schema/workflows.ts";

/** Quote and apply (spec "Applying for leave", "Working-day calculation"). */
describe("leave applications", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    w = await createLeaveWorld();
  });
  afterEach(() => w.close());

  const typeId = async (code: string) => {
    const res = await (await w.as("staff")).get("/api/v1/leave/types");
    const body = (await res.json()) as { items: { id: string; code: string }[] };
    const found = body.items.find((t) => t.code === code);
    if (!found) throw new Error(`no type ${code}`);
    return found.id;
  };
  const pdf = { filename: "mc.pdf", contentType: "application/pdf", dataBase64: btoa("%PDF-1.4\n%fake mc\n") };

  it("every statutory type is there with no setup", async () => {
    const res = await (await w.as("staff")).get("/api/v1/leave/types");
    expect(res.status).toBe(200);
    const codes = ((await res.json()) as { items: { code: string }[] }).items.map((t) => t.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "annual",
        "sick_outpatient",
        "hospitalisation",
        "maternity",
        "paternity",
        "shared_parental",
        "childcare",
        "extended_childcare",
        "infant_care",
        "adoption",
        "ns",
        "no_pay",
        "compassionate",
      ]),
    );
  });

  it("quotes working days with the Deepavali Monday in lieu and the balance after", async () => {
    const staff = await w.as("staff");
    const res = await staff.post("/api/v1/leave/quote", {
      leaveTypeId: await typeId("annual"),
      startDate: "2026-11-09",
      endDate: "2026-11-15",
    });
    expect(res.status).toBe(200);
    const q = (await res.json()) as {
      quantity: number;
      ok: boolean;
      days: { date: string; quantity: number; note: string | null }[];
      years: { year: number; available: number; after: number }[];
    };
    expect(q.ok).toBe(true);
    expect(q.quantity).toBe(4);
    expect(q.days[0]).toMatchObject({ date: "2026-11-09", quantity: 0, note: "Public holiday: Deepavali (in lieu)" });
    expect(q.days.find((d) => d.date === "2026-11-14")?.note).toBe("Off day");
    expect(q.days.find((d) => d.date === "2026-11-15")?.note).toBe("Rest day");
    // Hired 2 Jan 2024: service year 3 by 31 Dec 2026 → 9 days.
    expect(q.years).toEqual([{ year: 2026, quantity: 4, tracked: true, available: 9, after: 5 }]);
  });

  it("a Saturday holiday gives a Mon–Fri employee no Monday off; a Saturday rest day moves it to Sunday", async () => {
    const annual = await typeId("annual");
    const staff = await w.as("staff");
    const a = (await (
      await staff.post("/api/v1/leave/quote", { leaveTypeId: annual, startDate: "2026-03-20", endDate: "2026-03-23" })
    ).json()) as { quantity: number };
    expect(a.quantity).toBe(2);
    const satRest = await w.as("satRest");
    const b = (await (
      await satRest.post("/api/v1/leave/quote", { leaveTypeId: annual, startDate: "2026-03-21", endDate: "2026-03-23" })
    ).json()) as { quantity: number; days: { date: string; note: string | null }[] };
    expect(b.quantity).toBe(1);
    expect(b.days.map((d) => d.note)).toEqual(["Rest day", "Public holiday: Hari Raya Puasa (in lieu)", null]);
  });

  it("splits a leave across the year end", async () => {
    const q = (await (
      await (
        await w.as("staff")
      ).post("/api/v1/leave/quote", {
        leaveTypeId: await typeId("annual"),
        startDate: "2026-12-30",
        endDate: "2027-01-04",
      })
    ).json()) as { quantity: number; years: { year: number; quantity: number }[] };
    expect(q.quantity).toBe(3);
    expect(q.years.map((y) => [y.year, y.quantity])).toEqual([
      [2026, 2],
      [2027, 1],
    ]);
  });

  it("refuses more than the balance, overlaps by session, a missing MC and half days where not allowed", async () => {
    const staff = await w.as("staff");
    const annual = await typeId("annual");
    const tooMuch = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: annual,
      startDate: "2026-11-16",
      endDate: "2026-11-27",
    });
    expect(tooMuch.status).toBe(422);
    expect(((await tooMuch.json()) as { error: { code: string } }).error.code).toBe("insufficient_balance");

    const am = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: annual,
      startDate: "2026-11-16",
      endDate: "2026-11-16",
      startSession: "am",
    });
    expect(am.status).toBe(201);
    const pm = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: annual,
      startDate: "2026-11-16",
      endDate: "2026-11-16",
      startSession: "pm",
    });
    expect(pm.status).toBe(201);
    const clash = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: annual,
      startDate: "2026-11-16",
      endDate: "2026-11-17",
    });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { code: string } }).error.code).toBe("leave_overlap");

    const noMc = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId("sick_outpatient"),
      startDate: "2026-11-18",
      endDate: "2026-11-18",
    });
    expect(noMc.status).toBe(400);
    const body = (await noMc.json()) as { error: { message: string; details: { issues: { path: string }[] } } };
    expect(body.error.message).toMatch(/Medical certificate/);
    expect(body.error.details.issues[0]?.path).toBe("attachments");
    const withMc = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId("sick_outpatient"),
      startDate: "2026-11-18",
      endDate: "2026-11-18",
      attachments: [pdf],
    });
    expect(withMc.status).toBe(201);
    expect(((await withMc.json()) as { attachments: { filename: string }[] }).attachments[0]?.filename).toBe("mc.pdf");

    const nsHalf = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId("ns"),
      startDate: "2026-11-19",
      endDate: "2026-11-19",
      startSession: "am",
      attachments: [pdf],
    });
    expect(nsHalf.status).toBe(400);
  });

  it("HR applies on behalf: routed as the employee's own request", async () => {
    const hr = await w.as("hr");
    const res = await hr.post("/api/v1/leave/requests", {
      employeeId: w.emp.staff,
      leaveTypeId: await typeId("annual"),
      startDate: "2026-11-23",
      endDate: "2026-11-24",
      reason: "Entered from a paper form",
    });
    expect(res.status).toBe(201);
    const r = (await res.json()) as { onBehalf: boolean; approvalRequestId: string; employee: { id: string } };
    expect(r).toMatchObject({ onBehalf: true, employee: { id: w.emp.staff } });
    const [request] = await w.deps.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, r.approvalRequestId));
    expect(request?.requesterMembershipId).toBe(w.m.staff.membershipId);
    // A colleague can't apply for someone else.
    const other = await w.as("other");
    const denied = await other.post("/api/v1/leave/requests", {
      employeeId: w.emp.staff,
      leaveTypeId: await typeId("annual"),
      startDate: "2026-11-25",
      endDate: "2026-11-25",
    });
    expect(denied.status).toBe(404);
  });

  it("two applications racing for the same balance: exactly one wins", async () => {
    const hr = await w.as("hr");
    const annual = await typeId("annual");
    // 9 days − 7 = 2 days left.
    expect(
      (
        await hr.post("/api/v1/leave/adjustments", {
          employeeId: w.emp.staff,
          leaveTypeId: annual,
          year: 2026,
          amount: -7,
          reason: "Taken before Crow HR",
        })
      ).status,
    ).toBe(201);
    const staff = await w.as("staff");
    const results = await Promise.all([
      staff.post("/api/v1/leave/requests", { leaveTypeId: annual, startDate: "2026-12-01", endDate: "2026-12-02" }),
      staff.post("/api/v1/leave/requests", { leaveTypeId: annual, startDate: "2026-12-08", endDate: "2026-12-09" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 422]);
    const loser = results.find((r) => r.status === 422) as Response;
    expect(((await loser.json()) as { error: { code: string } }).error.code).toBe("insufficient_balance");
  });

  it("first-year eligibility at three months and pro-rating", async () => {
    w.clock.set("2026-10-13T01:00:00.000Z");
    const newbie = await w.as("newbie");
    const before = (await (await newbie.get("/api/v1/leave/balances")).json()) as {
      items: { code: string; eligible: boolean; available: number; eligibleFrom: string | null }[];
    };
    expect(before.items.find((b) => b.code === "annual")).toMatchObject({
      eligible: false,
      available: 0,
      eligibleFrom: "2026-10-14",
    });
    w.clock.set("2026-10-14T01:00:00.000Z");
    const after = (await (await (await w.as("newbie")).get("/api/v1/leave/balances")).json()) as {
      items: { code: string; eligible: boolean; available: number; explanation: string[] }[];
    };
    const annual = after.items.find((b) => b.code === "annual");
    expect(annual).toMatchObject({ eligible: true, available: 2 });
    expect(annual?.explanation.join(" ")).toMatch(/3\/12 × 7 = 1\.75 → 2 days/);
    // Sick leave at 3 months: 5 outpatient, 15 hospitalisation.
    expect(after.items.find((b) => b.code === "sick_outpatient")?.available).toBe(5);
    expect(after.items.find((b) => b.code === "hospitalisation")?.available).toBe(15);
  });

  it("a per-child entitlement spanning two leave years is checked once, not per year", async () => {
    const farah = await w.as("other");
    const kid = await farah.post("/api/v1/leave/children", {
      name: "Baby",
      birthDate: "2026-10-01",
      isCitizen: true,
      birthOrder: 1,
    });
    const childId = ((await kid.json()) as { id: string }).id;
    const q = (await (
      await farah.post("/api/v1/leave/quote", {
        leaveTypeId: await typeId("maternity"),
        startDate: "2026-10-01",
        endDate: "2027-03-31",
        childId,
      })
    ).json()) as {
      years: { year: number; quantity: number; available: number }[];
      issues: { code: string; message: string }[];
    };
    expect(q.years.map((y) => y.year)).toEqual([2026, 2027]);
    expect(q.years[0]?.available).toBe(80);
    expect(q.years[1]?.available).toBe(80 - (q.years[0]?.quantity ?? 0));
    expect(q.issues.map((i) => i.code)).toEqual(["insufficient_balance"]);
  });

  it("a part-timer's leave is in hours from the comparable full-timer", async () => {
    const pt = await w.as("partTimer");
    const balances = (await (await pt.get("/api/v1/leave/balances")).json()) as {
      items: { code: string; unit: string; available: number }[];
    };
    // Service year 2 → 8 days; 20 h / 40 h a week × 8 days × 8 h = 32 h.
    expect(balances.items.find((b) => b.code === "annual")).toMatchObject({ unit: "hours", available: 32 });
    const q = (await (
      await pt.post("/api/v1/leave/quote", {
        leaveTypeId: await typeId("annual"),
        startDate: "2026-11-16",
        endDate: "2026-11-17",
      })
    ).json()) as { quantity: number; unit: string };
    expect(q).toMatchObject({ quantity: 8, unit: "hours" });
  });
});
