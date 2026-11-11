import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import { createSchedulingWorld, ok, type SchedulingWorld } from "../../testing/scheduling.ts";
import { listRosterDaysWorked } from "../attendance/outputs.ts";
import { attendancePunches } from "../db/schema/attendance.ts";
import { listScheduledDays } from "./feeds.ts";

/**
 * The published roster as the expected schedule (spec "The published roster as the schedule"):
 * attendance lateness and OT, and leave's working-day count, for staff on a `shift` schedule.
 */
let w: SchedulingWorld;
let manager: TestClient;
const api = "/api/v1/scheduling";

interface Day {
  date: string;
  dayType: string;
  scheduledMinutes: number;
  scheduledStart: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  otMinutes: number;
}

async function punch(employeeId: string, date: string, kind: "in" | "out", time: string) {
  const at = new Date(`${date}T${time}:00+08:00`);
  await w.deps.db.insert(attendancePunches).values({
    id: w.deps.ids.newId(),
    orgId: w.orgId,
    employeeId,
    kind,
    idempotencyKey: `${employeeId}-${date}-${kind}-${time}`,
    source: "web",
    deviceTime: at,
    sentAt: at,
    serverTime: at,
    recordedAt: at,
    workDate: date,
    skewSeconds: 0,
  });
}

const sheet = async (employeeId: string, from: string, to: string) =>
  (
    await ok<{ days: Day[] }>(
      manager.get(`/api/v1/attendance/timesheet?employeeId=${employeeId}&from=${from}&to=${to}`),
    )
  ).days;

beforeAll(async () => {
  w = await createSchedulingWorld();
  manager = await w.as("manager");
  const id = (
    await ok<{ id: string }>(manager.post(`${api}/rosters`, { weekStart: "2026-11-02", locationId: w.locationId }))
  ).id;
  const add = (employeeId: string, date: string, startTime: string, endTime: string, kind = "shift") =>
    ok(
      manager.post(`${api}/rosters/${id}/shifts`, {
        employeeId,
        date,
        kind,
        ...(kind === "shift" ? { startTime, endTime, breakMinutes: 30 } : {}),
      }),
      201,
    );
  await add(w.crew.crewA, "2026-11-02", "07:00", "15:00");
  await add(w.crew.crewA, "2026-11-03", "10:00", "18:00");
  await add(w.crew.crewA, "2026-11-04", "", "", "rest");
  await add(w.emp.staff, "2026-11-02", "12:00", "20:00"); // Ravi works a fixed office week
  await add(w.crew.crewB, "2026-11-02", "07:00", "15:00");
  await add(w.crew.crewB, "2026-11-04", "07:00", "15:00");
  await add(w.crew.crewB, "2026-11-08", "", "", "rest"); // Deepavali falls on Nurul's rest day
  await ok(manager.post(`${api}/rosters/${id}/publish`, {}));
  // A draft for the week after: never used by attendance or leave.
  const draft = (
    await ok<{ id: string }>(manager.post(`${api}/rosters`, { weekStart: "2026-11-09", locationId: w.locationId }))
  ).id;
  await ok(
    manager.post(`${api}/rosters/${draft}/shifts`, {
      employeeId: w.crew.crewA,
      date: "2026-11-09",
      startTime: "07:00",
      endTime: "11:00",
      breakMinutes: 0,
    }),
    201,
  );
  await punch(w.crew.crewA, "2026-11-02", "in", "07:12");
  await punch(w.crew.crewA, "2026-11-02", "out", "16:00");
  await punch(w.crew.crewA, "2026-11-03", "in", "09:58");
  await punch(w.crew.crewA, "2026-11-03", "out", "17:30");
  await punch(w.crew.crewA, "2026-11-05", "in", "10:00");
  await punch(w.crew.crewA, "2026-11-05", "out", "14:00");
  await punch(w.crew.crewA, "2026-11-09", "in", "07:00");
  await punch(w.crew.crewA, "2026-11-09", "out", "15:30");
  await punch(w.crew.crewB, "2026-11-02", "in", "07:00");
  await punch(w.crew.crewB, "2026-11-02", "out", "15:00");
  await punch(w.crew.crewB, "2026-11-04", "in", "07:00");
  await punch(w.crew.crewB, "2026-11-04", "out", "15:00");
  await punch(w.emp.staff, "2026-11-02", "in", "09:00");
  await punch(w.emp.staff, "2026-11-02", "out", "18:00");
  w.clock.set("2026-11-10T04:00:00.000Z");
  manager = await w.as("manager");
}, 60_000);
afterAll(() => w.close());

describe("payroll's roster days", () => {
  it("a public holiday on a rostered rest day counts in neither scheduled days nor days worked", async () => {
    const scheduled = (await listScheduledDays(w.deps.db, w.orgId, "2026-11-02", "2026-11-08")).find(
      (r) => r.employeeId === w.crew.crewB,
    );
    const worked = (await listRosterDaysWorked(w.deps.db, w.orgId, "2026-11-02", "2026-11-08")).find(
      (r) => r.employeeId === w.crew.crewB,
    );
    // Two shifts, both worked; Deepavali (Sun 8 Nov) is the rest day: no no-pay leave, full pay.
    expect(scheduled?.scheduledDays).toBe(2);
    expect(worked?.daysWorked).toBe(2);
  });
});

describe("attendance uses the published roster", () => {
  it("lateness and OT against the shift; early out; unrostered days are all OT", async () => {
    const days = await sheet(w.crew.crewA, "2026-11-02", "2026-11-05");
    const [mon, tue, wed, thu] = days;
    // 07:12–16:00 = 528 min, less the rostered 30-min break = 498; shift pays 450 → 48 min over → 45 in 15-min blocks.
    expect(mon).toMatchObject({
      dayType: "shift",
      scheduledMinutes: 450,
      scheduledStart: "07:00",
      workedMinutes: 498,
      breakMinutes: 30,
      lateMinutes: 12,
      earlyOutMinutes: 0,
      otMinutes: 45,
    });
    expect(tue).toMatchObject({
      scheduledStart: "10:00",
      lateMinutes: 0,
      earlyOutMinutes: 30,
      otMinutes: 0,
      workedMinutes: 422,
    });
    expect(wed).toMatchObject({ dayType: "rest", scheduledMinutes: 0, workedMinutes: 0 });
    expect(thu).toMatchObject({ dayType: "off", scheduledMinutes: 0, workedMinutes: 240, otMinutes: 240 });
  });

  it("a draft week is ignored: the work schedule fallback applies", async () => {
    const [mon] = await sheet(w.crew.crewA, "2026-11-09", "2026-11-09");
    // 44 h a week / 5 = 528 min; 07:00–15:30 is 510 min less a 60-min break (span > 6 h).
    expect(mon).toMatchObject({
      dayType: "shift",
      scheduledMinutes: 528,
      scheduledStart: null,
      workedMinutes: 450,
      otMinutes: 0,
    });
  });

  it("fixed-week staff keep their contractual week", async () => {
    const [mon] = await sheet(w.emp.staff, "2026-11-02", "2026-11-02");
    expect(mon).toMatchObject({ dayType: "working", scheduledStart: "09:00", lateMinutes: 0 });
  });
});

describe("leave counts rostered days", () => {
  const quote = async (client: TestClient, startDate: string, endDate: string) => {
    const types = await ok<{ items: { id: string; code: string }[] }>(client.get("/api/v1/leave/types"));
    return ok<{
      quantity: number;
      days: { date: string; quantity: number; note: string | null }[];
      warnings: string[];
    }>(
      client.post("/api/v1/leave/quote", {
        leaveTypeId: types.items.find((t) => t.code === "annual")?.id,
        startDate,
        endDate,
      }),
    );
  };

  it("Monday to Wednesday with no shift on Tuesday counts 2 days", async () => {
    const q = await quote(await w.asCrew("crewB"), "2026-11-02", "2026-11-04");
    expect(q.quantity).toBe(2);
    expect(q.days.map((d) => [d.date, d.quantity, d.note])).toEqual([
      ["2026-11-02", 1, null],
      ["2026-11-03", 0, "Not rostered"],
      ["2026-11-04", 1, null],
    ]);
    expect(q.warnings.join(" ")).not.toMatch(/shift schedule/);
  });

  it("a marked rest day is not counted; an unpublished week falls back with a warning", async () => {
    const crewA = await w.asCrew("crewA");
    const rest = await quote(crewA, "2026-11-04", "2026-11-04");
    expect(rest.days[0]).toMatchObject({ quantity: 0, note: "Rest day" });
    const fallback = await quote(crewA, "2026-11-11", "2026-11-13");
    expect(fallback.quantity).toBe(3);
    // Read by the person applying (often the employee, in the web or the apps), not only HR.
    expect(fallback.warnings).toContain(
      "Some of these dates have no published roster yet, so every one of them except public holidays is counted. Leave out any rest days, or apply once the roster is published.",
    );
    expect(fallback.warnings.join(" ")).not.toMatch(/This employee/);
  });
});
