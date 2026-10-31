import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import { clientAs, createTestDb, movableClock, seedMember, type TestClient, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { applyLeaveAs, decideAll, ok } from "../../testing/scheduling.ts";
import { employmentRecords } from "../db/schema/employees.ts";
import { locations } from "../db/schema/organisation.ts";
import { users } from "../db/schema/users.ts";
import { buildActor } from "../employees/access.ts";
import { defaultPeoplePorts } from "../employees/ports.ts";
import { createWorkSchedule } from "../organisation/work-schedules.ts";

/**
 * A rostered café worker's November, end to end with no doubles: published rosters → clock-ins
 * through the punch API → OT claims approved → one no-pay day → the payroll run. Payroll gets
 * "Scheduled days" from the published roster (no SCHEDULED_DAYS_REQUIRED block), "Days worked"
 * from attendance and approved OT, and computes exact cents. A manual item still wins.
 *
 * Lee Wei Ming: citizen born 15 Jun 1995 (31: CPF 20% + 17%), S$2,200 basic + S$200 transport,
 * works Tue–Sat 10:00–19:00 (1 h break, 8 h paid), rest day Monday. Deepavali is Sun 8 Nov.
 */
let t: TestDb;
let p: PayrollHttp<"A">;
let lee: { membershipId: string; userId: string };
let owner: TestClient;
let admin: TestClient;
const clock = movableClock("2026-10-20T01:00:00.000Z");
const api = "/api/v1/scheduling";
const WEEKS = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"];
const rosterIds: Record<string, string> = {};

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const asLee = () => clientAs(p.app, p.co.h.deps, lee as never);
const asOwner = async () => {
  owner = await clientAs(p.app, p.co.h.deps, ownerMember as never);
  return owner;
};
let ownerMember: { membershipId: string; userId: string };

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(
    t,
    [
      {
        key: "A",
        name: "Lee Wei Ming",
        dob: "1995-06-15",
        residency: "citizen",
        hireDate: "2025-03-03",
        basicCents: 220_000,
      },
    ],
    { clock },
  );
  const deps = p.co.h.deps;
  const orgId = p.co.h.orgId;
  // Make Lee rostered: a shift work schedule (no fixed week).
  const actor = buildActor({
    db: deps.db,
    orgId,
    userId: null,
    requestId: null,
    roles: ["owner"],
    employeeId: null,
    today: "2026-10-20",
  });
  const roster = await createWorkSchedule(deps, defaultPeoplePorts(deps), actor, {
    name: "Café roster",
    kind: "shift",
    weeklyMinutes: 44 * 60,
  });
  await deps.db
    .update(employmentRecords)
    .set({ workScheduleId: roster.id })
    .where(and(eq(employmentRecords.orgId, orgId), eq(employmentRecords.employeeId, p.co.e.A)));
  lee = await seedMember(deps, orgId, { employeeId: p.co.e.A, email: "lee@kopikaki.example" });
  ownerMember = await seedMember(deps, orgId, { roles: ["owner"], email: "boss@kopikaki.example" });
  // Admins have enrolled MFA, so the clock may move past the 7-day enrolment grace.
  await deps.db.update(users).set({ mfaEnrolledAt: clock.now() });
  await asOwner();
  const [loc] = await deps.db.select().from(locations).where(eq(locations.orgId, orgId));
  // Six published weeks cover every date of November: Tue–Sat shifts, Monday marked as the rest day.
  for (const week of WEEKS) {
    const id = (await ok<{ id: string }>(owner.post(`${api}/rosters`, { weekStart: week, locationId: loc?.id }))).id;
    rosterIds[week] = id;
    await ok(owner.post(`${api}/rosters/${id}/shifts`, { employeeId: p.co.e.A, date: week, kind: "rest" }), 201);
    for (let i = 1; i <= 5; i++) {
      await ok(
        owner.post(`${api}/rosters/${id}/shifts`, {
          employeeId: p.co.e.A,
          date: addDays(week, i),
          startTime: "10:00",
          endTime: "19:00",
          breakMinutes: 60,
        }),
        201,
      );
    }
    if (week !== "2026-11-30") await ok(owner.post(`${api}/rosters/${id}/publish`, {}));
  }
  // One day of no-pay leave on Thu 19 Nov (a rostered day), approved by the owner (no manager).
  await applyLeaveAs(await asLee(), "no_pay", "2026-11-19");
  await decideAll(owner, "leave");
  // Clock in and out through the API on every rostered November day but the 19th. Fridays run to
  // 21:00 (2 h of OT); Tuesday 3 Nov starts 20 minutes late.
  for (let d = "2026-11-01"; d <= "2026-11-30"; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 1 || d === "2026-11-19") continue;
    const inAt = d === "2026-11-03" ? `${d}T10:20:00+08:00` : `${d}T09:55:00+08:00`;
    const outAt = dow === 5 ? `${d}T21:00:00+08:00` : `${d}T19:02:00+08:00`;
    clock.set(inAt);
    await ok(punch(await asLee(), "in", new Date(inAt).toISOString()), 201);
    clock.set(outAt);
    await ok(punch(await asLee(), "out", new Date(outAt).toISOString()), 201);
    if (dow === 5) {
      await ok(
        asLee().then((c) =>
          c.post("/api/v1/attendance/overtime", { date: d, minutes: 120, reason: "Close and stocktake" }),
        ),
        201,
      );
    }
  }
  clock.set("2026-11-30T12:00:00.000Z");
  await asOwner();
  await decideAll(owner, "overtime");
  admin = await clientAs(
    p.app,
    deps,
    await seedMember(deps, orgId, { roles: ["payroll_admin"], email: "pay@kopikaki.example" }),
  );
  await deps.db.update(users).set({ mfaEnrolledAt: clock.now() });
}, 180_000);
afterAll(() => t.close());

interface Detail {
  input: { items: { kind: string; days: number | null; minutes: number | null; source: string; label: string }[] };
  result: {
    lines: { code: string; label: string; amountCents: number; detail: string | null }[];
    issues?: { code: string }[];
    month: { owCpfCents: number; cpfEmployeeCents: number; cpfEmployerCents: number; cpfTotalCents: number };
    totals: Record<string, number>;
  };
}
const detail = (runId: string) => p.ok<Detail>(admin.get(`/api/v1/payroll/runs/${runId}/employees/${p.co.e.A}`));
const issuesOf = async (runId: string) =>
  (
    await p.ok<{ issues: { code: string; employeeId: string | null }[] }>(admin.get(`/api/v1/payroll/runs/${runId}`))
  ).issues.map((i) => i.code);

describe("a rostered café worker's month", () => {
  let runId: string;

  it("blocks for scheduled days while the last week of November is unpublished", async () => {
    runId = (
      await p.ok<{ id: string }>(
        admin.post("/api/v1/payroll/runs", { kind: "regular", month: "2026-11", payDate: "2026-11-30" }),
        201,
      )
    ).id;
    await p.ok(admin.post(`/api/v1/payroll/runs/${runId}/compute`));
    expect(await issuesOf(runId)).toContain("SCHEDULED_DAYS_REQUIRED");
  });

  it("computes from the published roster once every week is published, with exact cents", async () => {
    await ok(owner.post(`${api}/rosters/${rosterIds["2026-11-30"]}/publish`, {}));
    await p.ok(admin.post(`/api/v1/payroll/runs/${runId}/compute`));
    expect(await issuesOf(runId)).not.toContain("SCHEDULED_DAYS_REQUIRED");
    const d = await detail(runId);
    expect(d.input.items.map((i) => [i.kind, i.days, i.minutes, i.label])).toEqual([
      ["unpaid_leave", 1, null, "No-pay leave (approved in Leave)"],
      ["days_worked", 20, null, "Days worked (from attendance)"],
      ["scheduled_days", 21, null, "Scheduled days (from published roster)"],
      ["overtime", null, 120, "Overtime (approved in attendance)"],
      ["overtime", null, 120, "Overtime (approved in attendance)"],
      ["overtime", null, 120, "Overtime (approved in attendance)"],
      ["overtime", null, 120, "Overtime (approved in attendance)"],
    ]);
    const line = (code: string) => d.result.lines.find((l) => l.code === code);
    // 20 Tue–Sat shifts + Deepavali (Sun 8 Nov) = 21 scheduled; 19 worked + Deepavali = 20 (no-pay on the 19th).
    expect(line("BASIC")).toMatchObject({ amountCents: 209_524, detail: "20 of 21 scheduled days" }); // 2,200 × 20/21
    expect(line("ALLOWANCE_TRANSPORT")?.amountCents).toBe(19_048); // 200 × 20/21
    // Each Friday's claim is its own OT period (paid within 14 days of the period it was worked):
    // 2 h × 1.5 × (12 × 2,200) / (52 × 44) = 34.615… → S$34.62, four times = S$138.48.
    const ot = d.result.lines.filter((l) => l.code.startsWith("OT") || l.label.startsWith("Overtime"));
    expect(ot.map((l) => l.amountCents)).toEqual([3_462, 3_462, 3_462, 3_462]);
    // OW 2,095.24 + 190.48 + 138.48 = 2,424.20: CPF 37% = 896.95 → S$897; employee 20% = 484.84 → S$484.
    expect(d.result.month).toMatchObject({
      owCpfCents: 242_420,
      cpfTotalCents: 89_700,
      cpfEmployeeCents: 48_400,
      cpfEmployerCents: 41_300,
    });
  });

  it("a manual Scheduled days item wins over the roster", async () => {
    await p.ok(
      admin.post(`/api/v1/payroll/runs/${runId}/items`, {
        employeeId: p.co.e.A,
        kind: "scheduled_days",
        label: "Scheduled days",
        days: 22,
      }),
      201,
    );
    await p.ok(admin.post(`/api/v1/payroll/runs/${runId}/compute`));
    const d = await detail(runId);
    expect(d.input.items.filter((i) => i.kind === "scheduled_days").map((i) => [i.days, i.source])).toEqual([
      [22, "manual"],
    ]);
    expect(d.result.lines.find((l) => l.code === "BASIC")).toMatchObject({
      amountCents: 200_000,
      detail: "20 of 22 scheduled days",
    });
  });
});
