import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSchedulingWorld, ok, type SchedulingWorld } from "../../testing/scheduling.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";

/** Security review #19 and the roster-view leaks: who decides swaps, what a team manager sees. */
let w: SchedulingWorld;
const api = "/api/v1/scheduling";
beforeEach(async () => {
  w = await createSchedulingWorld();
}, 60_000);
afterEach(() => w.close());

describe("#19 shift swaps: the beneficiary never decides", () => {
  it("a manager who accepts a report's give-away gets no task and can't approve it", async () => {
    const manager = await w.as("manager");
    const ali = await w.asCrew("crewA");
    const rosterId = (
      await ok<{ id: string }>(manager.post(`${api}/rosters`, { weekStart: "2026-11-09", locationId: w.locationId }))
    ).id;
    const shift = (
      await ok<{ id: string }>(
        manager.post(`${api}/rosters/${rosterId}/shifts`, {
          employeeId: w.crew.crewA,
          date: "2026-11-13",
          startTime: "07:00",
          endTime: "15:00",
          breakMinutes: 30,
        }),
        201,
      )
    ).id;
    await ok(manager.post(`${api}/rosters/${rosterId}/publish`, {}));
    const sent = await ok<{ id: string }>(
      ali.post(`${api}/swaps`, { kind: "giveaway", shiftId: shift, peerEmployeeId: w.emp.manager }),
      201,
    );
    await ok(manager.post(`${api}/swaps/${sent.id}/accept`));
    const [request] = await w.deps.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.subjectType, "shift_swap"), eq(approvalRequests.subjectId, sent.id)));
    expect(request?.excludedDeciderMembershipIds).toContain(w.m.manager.membershipId);
    const mine = await ok<{ items: { subjectType: string }[] }>(manager.get("/api/v1/approvals/tasks"));
    expect(mine.items.filter((t) => t.subjectType === "shift_swap")).toEqual([]);
    // Someone else decides: the manager step is skipped, HR gets it.
    const open = await w.deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, request?.id as string), eq(approvalTasks.status, "pending")));
    expect(open.length).toBeGreaterThan(0);
    expect(open.some((t) => t.assigneeMembershipId === w.m.manager.membershipId)).toBe(false);
    // A task planted for the manager is still refused at decision time.
    const [planted] = await w.deps.db
      .insert(approvalTasks)
      .values({
        id: w.deps.ids.newId(),
        orgId: w.orgId,
        requestId: request?.id as string,
        position: open[0]?.position ?? 1,
        assigneeMembershipId: w.m.manager.membershipId,
        origin: "reassigned",
        status: "pending",
        createdAt: w.clock.now(),
      })
      .returning();
    const d = await manager.post(`/api/v1/approvals/tasks/${planted?.id}/decision`, { decision: "approve" });
    expect(d.status).toBe(403);
  });
});

describe("roster views and publishing for a team manager", () => {
  it("hides non-reports' leave and employee numbers, and refuses publishing HR's changes for them", async () => {
    const hr = await w.as("hr");
    const other = await w.as("other");
    const types = await ok<{ items: { id: string; code: string }[] }>(other.get("/api/v1/leave/types"));
    const sick = types.items.find((t) => t.code === "sick_outpatient")?.id;
    const applied = await other.post("/api/v1/leave/requests", {
      leaveTypeId: sick,
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      reason: "flu",
      attachments: [{ filename: "mc.pdf", contentType: "application/pdf", dataBase64: btoa("%PDF-1.4\n") }],
    });
    expect(applied.status).toBe(201);
    const rosterId = (
      await ok<{ id: string }>(hr.post(`${api}/rosters`, { weekStart: "2026-11-09", locationId: w.locationId }))
    ).id;
    await ok(
      hr.post(`${api}/rosters/${rosterId}/shifts`, {
        employeeId: w.emp.other,
        date: "2026-11-10",
        startTime: "07:00",
        endTime: "15:00",
        breakMinutes: 30,
      }),
      201,
    );
    // HR sees the leave conflict and the employee number.
    const asHr = await ok<View>(hr.get(`${api}/rosters/${rosterId}`));
    expect(asHr.shifts.find((s) => s.employeeId === w.emp.other)?.conflicts.length).toBeGreaterThan(0);
    expect(asHr.employees.find((e) => e.id === w.emp.other)?.employeeNumber).not.toBe("");

    const manager = await w.as("manager");
    const view = await ok<View>(manager.get(`${api}/rosters/${rosterId}`));
    expect(view.mode).toBe("edit");
    expect(view.shifts.filter((s) => s.employeeId === w.emp.other).flatMap((s) => s.conflicts)).toEqual([]);
    const row = view.employees.find((e) => e.id === w.emp.other);
    expect(row).toMatchObject({ employeeNumber: "", warnings: [], restDayAssumed: null, editable: false });
    expect(view.toAcknowledge.filter((a) => a.employeeName === row?.name)).toEqual([]);
    // Their own report still shows in full.
    expect(view.employees.find((e) => e.id === w.crew.crewA)?.employeeNumber).not.toBe("");

    const pub = await manager.post(`${api}/rosters/${rosterId}/publish`, { acknowledge: [] });
    expect(pub.status).toBe(403);
    const body = (await pub.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/leave/i);
  });
});

interface View {
  mode: string;
  shifts: { employeeId: string | null; conflicts: unknown[] }[];
  employees: {
    id: string;
    name: string;
    employeeNumber: string;
    warnings: unknown[];
    restDayAssumed: string | null;
    editable: boolean;
  }[];
  toAcknowledge: { employeeName: string }[];
}
