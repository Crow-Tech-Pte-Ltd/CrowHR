import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedMember, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { notifications } from "../db/schema/notifications.ts";
import { tick } from "../jobs/tick.ts";
import { payrollCutoffReminder } from "../payroll/approval.ts";
import { CORE_WORKFLOW_PLUGINS } from "./registry.ts";

/**
 * The payroll-cutoff ReminderSource (add-approvals-and-notifications task 4.3, spec "Reminders":
 * 3 days before the cutoff date in payroll settings, to payroll_admins). The real source is the
 * payroll module's (`payroll/approval.ts`), registered in CORE_WORKFLOW_PLUGINS and run here through
 * the real tick sweep against real payroll settings and runs.
 */

const api = "/api/v1/payroll";
const DAY = 86_400_000;

describe("payroll cutoff reminder", () => {
  let t: TestDb;
  let p: PayrollHttp<"A">;
  let now: Date;
  let secondAdmin: string;
  let notRecipients: string[];

  beforeEach(async () => {
    now = new Date("2026-11-18T01:00:00.000Z");
    t = await createTestDb();
    p = await payrollHttp(
      t,
      [
        {
          key: "A",
          name: "Daud bin Hassan",
          dob: "1985-08-08",
          residency: "citizen",
          hireDate: "2020-09-01",
          basicCents: 260_000,
        },
      ],
      { clock: { now: () => new Date(now) } },
    );
    const deps = p.co.h.deps;
    secondAdmin = (await seedMember(deps, p.co.h.orgId, { roles: ["payroll_admin", "hr_admin"] })).membershipId;
    // Suspended payroll admins, HR admins and owners get nothing.
    notRecipients = [
      (await seedMember(deps, p.co.h.orgId, { roles: ["payroll_admin"], status: "suspended" })).membershipId,
      (await seedMember(deps, p.co.h.orgId, { roles: ["hr_admin"] })).membershipId,
      (await seedMember(deps, p.co.h.orgId, { roles: ["owner"] })).membershipId,
    ];
  }, 60_000);
  afterEach(() => t.close());

  async function tickDays(from: string, days: number) {
    now = new Date(`${from}T01:00:00.000Z`);
    for (let d = 0; d < days; d++) {
      await tick(p.co.h.deps, now);
      now = new Date(now.getTime() + DAY);
    }
  }

  const sent = async () =>
    (await t.db.select().from(notifications).where(eq(notifications.kind, "payroll_cutoff"))).map((n) => ({
      to: n.recipientMembershipId,
      title: n.title,
      at: n.createdAt.toISOString().slice(0, 10),
    }));

  it("is the payroll module's source, registered with workflows", () => {
    const sources = CORE_WORKFLOW_PLUGINS.flatMap(
      (f) => (typeof f === "function" ? f(p.co.h.deps) : f).reminders ?? [],
    );
    expect(sources.map((s) => s.id)).toContain("payroll_cutoff");
    expect(payrollCutoffReminder().id).toBe("payroll_cutoff");
  });

  it("goes to active payroll_admins 3 days before the cutoff, once", async () => {
    await p.ok(p.admin.put(`${api}/settings`, { cutoffDay: 25 }));
    await tickDays("2026-11-18", 10);
    const notes = await sent();
    // The harness's payroll admin and the second one; nobody else.
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.to)).toContain(secondAdmin);
    for (const id of notRecipients) expect(notes.map((n) => n.to)).not.toContain(id);
    expect(new Set(notes.map((n) => n.title))).toEqual(new Set(["November 2026 payroll cutoff is on 25 Nov 2026"]));
    // 22 Nov in Singapore (01:00 UTC is 09:00 SGT).
    expect(new Set(notes.map((n) => n.at))).toEqual(new Set(["2026-11-22"]));
  });

  it("is not sent once the month's regular run is approved", async () => {
    await p.ok(p.admin.put(`${api}/settings`, { cutoffDay: 25 }));
    await p.payRun({ kind: "regular", month: "2026-11", payDate: "2026-11-28" });
    await tickDays("2026-11-20", 6);
    expect(await sent()).toEqual([]);
  });

  it("reminds about a cutoff early next month 3 days before it, in the month before", async () => {
    await p.ok(p.admin.put(`${api}/settings`, { cutoffDay: 2 }));
    await tickDays("2026-11-27", 4);
    const notes = await sent();
    expect(new Set(notes.map((n) => n.title))).toEqual(new Set(["December 2026 payroll cutoff is on 2 Dec 2026"]));
    expect(new Set(notes.map((n) => n.at))).toEqual(new Set(["2026-11-29"]));
  });

  it("uses the last day of a short month for a cutoff on the 31st, and the pay day when no cutoff is set", async () => {
    await p.ok(p.admin.put(`${api}/settings`, { cutoffDay: 31 }));
    await tickDays("2026-11-25", 4);
    expect(new Set((await sent()).map((n) => n.title))).toEqual(
      new Set(["November 2026 payroll cutoff is on 30 Nov 2026"]),
    );
    expect(new Set((await sent()).map((n) => n.at))).toEqual(new Set(["2026-11-27"]));
  });

  it("stays quiet for an organisation without payroll settings", async () => {
    await tickDays("2026-11-25", 6);
    expect(await sent()).toEqual([]);
  });
});
