import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSchedulingWorld, ok, type SchedulingWorld } from "../../testing/scheduling.ts";
import { MAX_ACTIVE_TEMPLATES_PER_LOCATION } from "./templates.ts";

/** Settings → Shift templates (spec "Shift templates"). */
let w: SchedulingWorld;
const api = "/api/v1/scheduling";
const body = (o: Record<string, unknown> = {}) => ({
  name: "Morning",
  code: "AM",
  startTime: "07:00",
  endTime: "15:00",
  breakMinutes: 30,
  locationId: null,
  colour: "kuning",
  ...o,
});

beforeAll(async () => {
  w = await createSchedulingWorld();
}, 60_000);
afterAll(() => w.close());

describe("shift templates", () => {
  it("overnight: Night 22:00–06:00 with a 30-minute break pays 7 h 30 min", async () => {
    const hr = await w.as("hr");
    const { id } = await ok<{ id: string }>(
      hr.post(`${api}/templates`, body({ name: "Night", code: "n1", startTime: "22:00", endTime: "06:00" })),
      201,
    );
    const list = await ok<{ items: { id: string; code: string; paidMinutes: number; overnight: boolean }[] }>(
      hr.get(`${api}/templates`),
    );
    expect(list.items.find((t) => t.id === id)).toMatchObject({ code: "N1", paidMinutes: 450, overnight: true });
  });

  it("validates the break, the code and uniqueness, saying how to fix it", async () => {
    const hr = await w.as("hr");
    const tooLong = await hr.post(`${api}/templates`, body({ startTime: "09:00", endTime: "10:00", breakMinutes: 60 }));
    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(await tooLong.json())).toMatch(/shorter than the shift \(60 minutes\)/);
    expect((await hr.post(`${api}/templates`, body({ code: "TOOLONG" }))).status).toBe(400);
    expect((await hr.post(`${api}/templates`, body({ code: "" }))).status).toBe(400);
    await ok(hr.post(`${api}/templates`, body({ code: "PM", startTime: "15:00", endTime: "23:00" })), 201);
    const dup = await hr.post(`${api}/templates`, body({ code: "pm" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.message).toMatch(/already used/);
  });

  it("at most 30 active templates per location", async () => {
    const hr = await w.as("hr");
    for (let i = 0; i < MAX_ACTIVE_TEMPLATES_PER_LOCATION; i++) {
      await ok(hr.post(`${api}/templates`, body({ code: `L${i}`, locationId: w.bugisId })), 201);
    }
    const over = await hr.post(`${api}/templates`, body({ code: "L99", locationId: w.bugisId }));
    expect(over.status).toBe(409);
    expect((await over.json()).error.message).toMatch(/at most 30 active shift templates/);
  });

  it("a template in use is archived, not deleted; an unused one can be deleted", async () => {
    const hr = await w.as("hr");
    const { id } = await ok<{ id: string }>(
      hr.post(`${api}/templates`, body({ code: "MID", startTime: "11:00", endTime: "19:00" })),
      201,
    );
    const { id: rosterId } = await ok<{ id: string }>(
      hr.post(`${api}/rosters`, { weekStart: "2026-11-02", locationId: w.locationId }),
    );
    await ok(
      hr.post(`${api}/rosters/${rosterId}/shifts`, { employeeId: w.crew.crewA, date: "2026-11-03", templateId: id }),
      201,
    );
    const del = await hr.delete(`${api}/templates/${id}`);
    expect(del.status).toBe(409);
    expect((await del.json()).error.code).toBe("in_use");
    await ok(hr.post(`${api}/templates/${id}/archive`), 204);
    const list = await ok<{ items: { id: string; archived: boolean; inUse: boolean }[] }>(
      hr.get(`${api}/templates?includeArchived=true`),
    );
    expect(list.items.find((t) => t.id === id)).toMatchObject({ archived: true, inUse: true });
    expect((await ok<{ items: { id: string }[] }>(hr.get(`${api}/templates`))).items.some((t) => t.id === id)).toBe(
      false,
    );
    const { id: unused } = await ok<{ id: string }>(hr.post(`${api}/templates`, body({ code: "XX" })), 201);
    await ok(hr.delete(`${api}/templates/${unused}`), 204);
  });

  it("only owners and hr_admins maintain templates; managers can read them", async () => {
    const manager = await w.as("manager");
    expect((await manager.post(`${api}/templates`, body({ code: "MGR" }))).status).toBe(403);
    expect((await manager.get(`${api}/templates`)).status).toBe(200);
    expect((await (await w.as("payroll")).get(`${api}/templates`)).status).toBe(403);
  });
});
