import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";

/** Attachments (medical) and the team calendar (spec "Calendar and visibility"). */
describe("leave visibility", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    w = await createLeaveWorld();
  });
  afterEach(() => w.close());

  const typeId = async (c: TestClient, code: string) =>
    ((await (await c.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] }).items.find(
      (t) => t.code === code,
    )?.id as string;
  const pdf = (name = "mc.pdf") => ({
    filename: name,
    contentType: "application/pdf",
    dataBase64: btoa("%PDF-1.4\nMC\n"),
  });

  it("attachments: content must match the type; MC readable by requester, approver, HR and owner only", async () => {
    const staff = await w.as("staff");
    const sick = await typeId(staff, "sick_outpatient");
    const liar = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: sick,
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      attachments: [{ filename: "mc.png", contentType: "image/png", dataBase64: btoa("%PDF-1.4\n") }],
    });
    expect(liar.status).toBe(400);
    expect(((await liar.json()) as { error: { message: string } }).error.message).toMatch(
      /doesn't look like a PDF or photo/,
    );
    const big = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: sick,
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      attachments: [{ filename: "mc.pdf", contentType: "application/pdf", dataBase64: "A".repeat(7_100_000) }],
    });
    expect(big.status).toBe(400);
    const ok = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: sick,
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      attachments: [pdf()],
    });
    expect(ok.status).toBe(201);
    const r = (await ok.json()) as { id: string; attachments: { id: string }[] };
    const url = `/api/v1/leave/requests/${r.id}/attachments/${r.attachments[0]?.id}`;
    for (const who of ["staff", "manager", "hr", "owner"] as const) {
      const res = await (await w.as(who)).get(url);
      expect(res.status, who).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect(new TextDecoder().decode(await (await (await w.as("staff")).get(url)).arrayBuffer())).toBe("%PDF-1.4\nMC\n");
    // Not an approver, not in scope: 404 (indistinguishable from missing).
    expect((await (await w.as("other")).get(url)).status).toBe(404);
    expect((await (await w.as("payroll")).get(url)).status).toBe(404);
    // Attach a second file later.
    const more = await staff.post(`/api/v1/leave/requests/${r.id}/attachments`, { attachments: [pdf("mc-page2.pdf")] });
    expect(more.status).toBe(200);
    expect(((await more.json()) as { attachments: unknown[] }).attachments).toHaveLength(2);
  });

  it("the calendar hides sensitive types and reasons from colleagues", async () => {
    const staff = await w.as("staff");
    await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId(staff, "sick_outpatient"),
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      reason: "Gastric flu",
      attachments: [pdf()],
    });
    await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId(staff, "annual"),
      startDate: "2026-11-12",
      endDate: "2026-11-12",
    });
    const manager = await w.as("manager");
    const tasks = (await (await manager.get("/api/v1/approvals/tasks")).json()) as {
      items: { taskId: string; title: string }[];
    };
    const sickTask = tasks.items.find((t) => t.title.startsWith("Sick leave"));
    await manager.post(`/api/v1/approvals/tasks/${sickTask?.taskId}/decision`, { decision: "approve" });

    const range = "from=2026-11-09&to=2026-11-15";
    const team = (await (await manager.get(`/api/v1/leave/calendar?${range}&view=team`)).json()) as {
      people: { name: string; entries: { date: string; label: string; status: string; requestId: string | null }[] }[];
      holidays: { date: string; name: string }[];
    };
    const ravi = team.people.find((p) => p.name === "Ravi Kumar");
    expect(ravi?.entries.map((e) => [e.date, e.label, e.status])).toEqual([
      ["2026-11-10", "Sick leave (outpatient)", "approved"],
      ["2026-11-12", "Annual leave", "pending"],
    ]);
    expect(ravi?.entries[0]?.requestId).toBeTruthy();
    expect(team.people.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Wong Kai Wen", "Siti Rahmah", "Daniel Goh"]),
    );
    expect(team.people.some((p) => p.name === "Farah Hassan")).toBe(false);

    const other = await w.as("other");
    const org = (await (await other.get(`/api/v1/leave/calendar?${range}&view=org`)).json()) as {
      people: { name: string; entries: { label: string; typeCode: string | null; requestId: string | null }[] }[];
    };
    const seen = org.people.find((p) => p.name === "Ravi Kumar");
    expect(seen?.entries).toEqual([
      { date: "2026-11-10", session: "full", status: "approved", label: "On leave", typeCode: null, requestId: null },
    ]);
    expect(JSON.stringify(org)).not.toMatch(/Gastric/);
    // Requests themselves stay out of reach.
    expect((await other.get(`/api/v1/leave/requests/${ravi?.entries[0]?.requestId}`)).status).toBe(404);
    expect(((await other.get(`/api/v1/leave/calendar?from=2026-11-01&to=2027-03-01`)) as Response).status).toBe(400);
  });

  it("the calendar shows a Sunday holiday on the Monday in lieu, like the apply sheet", async () => {
    // Deepavali falls on Sunday 8 Nov 2026; Monday 9 Nov is the public holiday.
    const staff = await w.as("staff");
    const cal = (await (await staff.get("/api/v1/leave/calendar?from=2026-11-01&to=2026-11-15")).json()) as {
      holidays: { date: string; name: string }[];
    };
    expect(cal.holidays).toEqual([{ date: "2026-11-09", name: "Deepavali (in lieu)" }]);
    // At the edge of the range the holiday follows the day it is taken.
    const edge = (await (await staff.get("/api/v1/leave/calendar?from=2026-11-01&to=2026-11-08")).json()) as {
      holidays: unknown[];
    };
    expect(edge.holidays).toEqual([]);
    // The roster grid and the holiday list keep the gazetted dates.
    const list = (await (await staff.get("/api/v1/leave/holidays?year=2026")).json()) as {
      items: { date: string; name: string }[];
    };
    expect(list.items.find((h) => h.name === "Deepavali")?.date).toBe("2026-11-08");
  });
});
