import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";

/** Attendance summary export (spec "Attendance summary export"). */
describe("attendance summary", () => {
  let w: LeaveWorld;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
    const sent = "2026-11-13T02:00:00.000Z";
    const staff = await w.as("staff");
    // Tue 10 Nov: 09:12–18:00 (late 12); Wed 11 Nov: 09:00–17:30 (early out 30).
    await punch(staff, "in", "2026-11-10T01:12:00.000Z", { sentAt: sent, queued: true });
    await punch(staff, "out", "2026-11-10T10:00:00.000Z", { sentAt: sent, queued: true });
    await punch(staff, "in", "2026-11-11T01:00:00.000Z", { sentAt: sent, queued: true });
    await punch(staff, "out", "2026-11-11T09:30:00.000Z", { sentAt: sent, queued: true });
    const other = await w.as("other");
    await punch(other, "in", "2026-11-11T01:00:00.000Z", { sentAt: sent, queued: true });
  });
  afterAll(() => w.close());

  const Q = "from=2026-11-09&to=2026-11-13";

  it("summarises each employee for the period", async () => {
    const res = await (await w.as("hr")).get(`/api/v1/attendance/reports/summary?${Q}`);
    expect(res.status).toBe(200);
    const rows = (
      (await res.json()) as {
        items: {
          name: string;
          daysWorked: number;
          lateCount: number;
          lateMinutes: number;
          earlyOutCount: number;
          missingPunches: number;
          workedMinutes: number;
        }[];
      }
    ).items;
    expect(rows.find((r) => r.name === "Ravi Kumar")).toMatchObject({
      daysWorked: 2,
      lateCount: 1,
      lateMinutes: 12,
      earlyOutCount: 1,
      missingPunches: 0,
      workedMinutes: 468 + 450,
    });
    expect(rows.find((r) => r.name === "Farah Hassan")?.missingPunches).toBe(1);
    // Everyone employed in the period (the 7 employees of the world).
    expect(rows).toHaveLength(7);
  });

  it("exports CSV with a header row; a manager's export holds only their team", async () => {
    const res = await (await w.as("hr")).get(`/api/v1/attendance/reports/summary.csv?${Q}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/attendance-2026-11-09-2026-11-13\.csv/);
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe(
      "Employee,Days worked,Hours worked,Late days,Late minutes,Early-out days,Missing punches,OT hours (timesheet),OT hours (approved),Leave days",
    );
    expect(lines.find((l) => l.startsWith("Ravi Kumar"))).toBe("Ravi Kumar,2,15.30,1,12,1,0,0.00,0.00,0");
    const mgr = await (await w.as("manager")).get(`/api/v1/attendance/reports/summary.csv?${Q}`);
    const names = (await mgr.text())
      .trim()
      .split("\r\n")
      .slice(1)
      .map((l) => l.split(",")[0]);
    expect(names).toEqual(["Ahmad Ismail", "Daniel Goh", "Ravi Kumar", "Siti Rahmah"]);
  });

  it("employees and payroll admins can't run it; ranges are limited", async () => {
    expect((await (await w.as("staff")).get(`/api/v1/attendance/reports/summary?${Q}`)).status).toBe(403);
    expect((await (await w.as("payroll")).get(`/api/v1/attendance/reports/summary.csv?${Q}`)).status).toBe(403);
    expect(
      (await (await w.as("hr")).get("/api/v1/attendance/reports/summary?from=2026-01-01&to=2026-11-13")).status,
    ).toBe(400);
    expect(
      (await (await w.as("hr")).get("/api/v1/attendance/reports/summary?from=2026-11-13&to=2026-11-01")).status,
    ).toBe(400);
  });
});
