import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedOrg } from "../../testing/fixtures.ts";
import type { TestClient } from "../../testing/http.ts";
import { createSchedulingWorld, ok, type SchedulingWorld } from "../../testing/scheduling.ts";
import { employees } from "../db/schema/employees.ts";
import { locations } from "../db/schema/organisation.ts";
import { rosterShifts, rosters } from "../db/schema/scheduling.ts";
import { MAX_ROSTER_EMPLOYEES } from "./rosters.ts";

/** Rosters and shifts (spec "Rosters and assignments", "Schedule views and export"). */
let w: SchedulingWorld;
let manager: TestClient;
let hr: TestClient;
let am: string;
const api = "/api/v1/scheduling";

interface View {
  roster: { id: string | null; status: string; hasChanges: boolean };
  mode: string;
  days: { date: string; holiday: string | null; minutes: number }[];
  employees: { id: string; name: string; editable: boolean; minutes: number }[];
  shifts: {
    id: string;
    employeeId: string | null;
    kind: string;
    date: string;
    start: string | null;
    end: string | null;
    paidMinutes: number;
    templateCode: string | null;
    updatedAt: string;
    conflicts: { kind: string; label: string }[];
  }[];
}

const open = async (client: TestClient, weekStart: string, locationId = w.locationId) =>
  (await ok<{ id: string }>(client.post(`${api}/rosters`, { weekStart, locationId }))).id;
const view = (client: TestClient, weekStart: string, locationId = w.locationId) =>
  ok<View>(client.get(`${api}/rosters?weekStart=${weekStart}&locationId=${locationId}`));

beforeAll(async () => {
  w = await createSchedulingWorld();
  manager = await w.as("manager");
  hr = await w.as("hr");
  am = (
    await ok<{ id: string }>(
      hr.post(`${api}/templates`, {
        name: "Morning",
        code: "AM",
        startTime: "07:00",
        endTime: "15:00",
        breakMinutes: 30,
        locationId: null,
        colour: "kuning",
      }),
      201,
    )
  ).id;
}, 60_000);
afterAll(() => w.close());

describe("rosters and shifts", () => {
  it("a manager builds a week from templates for their team; the grid lists everyone eligible", async () => {
    const id = await open(manager, "2026-11-02");
    expect(await open(manager, "2026-11-02")).toBe(id); // idempotent
    await ok(
      manager.post(`${api}/rosters/${id}/shifts`, { employeeId: w.crew.crewA, date: "2026-11-02", templateId: am }),
      201,
    );
    await ok(
      manager.post(`${api}/rosters/${id}/shifts`, {
        employeeId: w.crew.crewB,
        date: "2026-11-02",
        startTime: "15:00",
        endTime: "23:00",
        breakMinutes: 45,
        note: "Close",
      }),
      201,
    );
    const v = await view(manager, "2026-11-04"); // any date of the week
    expect(v.mode).toBe("edit");
    expect(v.roster.status).toBe("draft");
    const names = v.employees.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(["Lee Wei Ming", "Nurul Huda", "Chen Jun", "Ravi Kumar", "Farah Hassan"]),
    );
    expect(names).not.toContain("Priya Nair"); // another outlet
    expect(v.employees.find((e) => e.name === "Lee Wei Ming")).toMatchObject({ editable: true, minutes: 450 });
    expect(v.employees.find((e) => e.name === "Farah Hassan")?.editable).toBe(false); // not Kai Wen's team
    const a = v.shifts.find((s) => s.employeeId === w.crew.crewA);
    expect(a).toMatchObject({ start: "07:00", end: "15:00", paidMinutes: 450, templateCode: "AM" });
    expect(v.days[0]).toMatchObject({ date: "2026-11-02", minutes: 450 + 435 });
    expect(v.days[6]?.holiday).toBe("Deepavali");
  });

  it("managers assign only their team; staff at another location are not eligible", async () => {
    const id = await open(manager, "2026-11-02");
    const farah = await manager.post(`${api}/rosters/${id}/shifts`, {
      employeeId: w.emp.other,
      date: "2026-11-03",
      templateId: am,
    });
    expect(farah.status).toBe(404);
    const priya = await hr.post(`${api}/rosters/${id}/shifts`, {
      employeeId: w.crew.bugis,
      date: "2026-11-03",
      templateId: am,
    });
    expect(priya.status).toBe(422);
    expect((await priya.json()).error.message).toMatch(/Priya Nair doesn't work at Tanjong Pagar HQ/);
    // A manager with no team at the Bugis outlet can't open its roster; HR can.
    await ok(hr.post(`${api}/rosters`, { weekStart: "2026-11-02", locationId: w.bugisId }));
    // Kai Wen manages Priya, so he can; Farah (no reports) cannot roster at all.
    expect(
      (await (await w.as("other")).post(`${api}/rosters`, { weekStart: "2026-11-02", locationId: w.locationId }))
        .status,
    ).toBe(403);
  });

  it("an overlapping shift is refused with 409 shift_overlap naming the existing one", async () => {
    const id = await open(manager, "2026-11-02");
    await ok(
      manager.post(`${api}/rosters/${id}/shifts`, {
        employeeId: w.crew.crewA,
        date: "2026-11-03",
        startTime: "09:00",
        endTime: "17:00",
      }),
      201,
    );
    const r = await manager.post(`${api}/rosters/${id}/shifts`, {
      employeeId: w.crew.crewA,
      date: "2026-11-03",
      startTime: "16:00",
      endTime: "22:00",
    });
    expect(r.status).toBe(409);
    const err = (await r.json()).error;
    expect(err.code).toBe("shift_overlap");
    expect(err.message).toBe(
      "Lee Wei Ming already works 09:00–17:00 on Tue 3 Nov 2026. Change the times or pick someone else.",
    );
  });

  it("stale edits answer 409; moves keep the times; open shifts and rest days", async () => {
    const id = await open(manager, "2026-11-02");
    const s = await ok<{ id: string; updatedAt: string }>(
      manager.post(`${api}/rosters/${id}/shifts`, { employeeId: w.crew.crewB, date: "2026-11-04", templateId: am }),
      201,
    );
    w.clock.advance(1000);
    const moved = await ok<{ updatedAt: string }>(
      manager.patch(`${api}/shifts/${s.id}`, {
        employeeId: w.crew.crewB,
        date: "2026-11-05",
        templateId: am,
        expectedUpdatedAt: s.updatedAt,
      }),
    );
    w.clock.advance(1000);
    const stale = await hr.patch(`${api}/shifts/${s.id}`, {
      employeeId: w.crew.crewB,
      date: "2026-11-06",
      templateId: am,
      expectedUpdatedAt: s.updatedAt,
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("stale");
    expect(moved.updatedAt).not.toBe(s.updatedAt);
    // Open shift (no one yet) and a rest day.
    await ok(
      manager.post(`${api}/rosters/${id}/shifts`, { employeeId: null, date: "2026-11-06", templateId: am }),
      201,
    );
    await ok(
      manager.post(`${api}/rosters/${id}/shifts`, { employeeId: w.crew.crewB, date: "2026-11-07", kind: "rest" }),
      201,
    );
    const dupRest = await manager.post(`${api}/rosters/${id}/shifts`, {
      employeeId: w.crew.crewB,
      date: "2026-11-07",
      kind: "rest",
    });
    expect(dupRest.status).toBe(409);
    const v = await view(manager, "2026-11-02");
    expect(v.shifts.filter((x) => x.employeeId === null)).toHaveLength(1);
    expect(v.shifts.find((x) => x.kind === "rest")).toMatchObject({ employeeId: w.crew.crewB, date: "2026-11-07" });
    const outside = await manager.post(`${api}/rosters/${id}/shifts`, {
      employeeId: w.crew.crewA,
      date: "2026-11-09",
      templateId: am,
    });
    expect(outside.status).toBe(400);
  });

  it("copy last week: copies the still-eligible and reports who was skipped and why", async () => {
    const wk1 = await open(manager, "2026-11-09");
    for (const e of [w.crew.crewA, w.crew.crewC]) {
      for (const d of ["2026-11-12", "2026-11-13"]) {
        await ok(manager.post(`${api}/rosters/${wk1}/shifts`, { employeeId: e, date: d, templateId: am }), 201);
      }
    }
    const wk2 = await open(manager, "2026-11-16");
    const r = await ok<{ copied: number; skipped: { employeeName: string; reason: string }[]; message: string }>(
      manager.post(`${api}/rosters/${wk2}/copy-previous`),
    );
    expect(r.copied).toBe(2);
    expect(r.skipped).toHaveLength(2);
    expect(r.message).toBe("2 shifts copied. 2 shifts not copied: Chen Jun left on 13 Nov 2026.");
    const cleared = await ok<{ removed: number }>(manager.post(`${api}/rosters/${wk2}/clear`));
    expect(cleared.removed).toBe(2);
    expect((await view(manager, "2026-11-16")).shifts).toHaveLength(0);
  });

  it("copying last week twice adds its open shifts once (two identical ones stay two)", async () => {
    const wk1 = await open(manager, "2026-11-23");
    for (let i = 0; i < 2; i++)
      await ok(
        manager.post(`${api}/rosters/${wk1}/shifts`, { employeeId: null, date: "2026-11-26", templateId: am }),
        201,
      );
    const wk2 = await open(manager, "2026-11-30");
    await ok(manager.post(`${api}/rosters/${wk2}/copy-previous`));
    await ok(manager.post(`${api}/rosters/${wk2}/copy-previous`));
    const openShifts = (await view(manager, "2026-11-30")).shifts.filter((s) => s.employeeId === null);
    expect(openShifts.map((s) => s.date)).toEqual(["2026-12-03", "2026-12-03"]);
  });

  it(`a roster holds at most ${MAX_ROSTER_EMPLOYEES} employees`, async () => {
    const id = await open(hr, "2026-11-23");
    const rows = [];
    const people = [];
    for (let i = 0; i < MAX_ROSTER_EMPLOYEES; i++) {
      const e = w.deps.ids.newId();
      people.push({
        id: e,
        orgId: w.orgId,
        employeeNumber: `CAP${i}`,
        legalName: `Cap ${i}`,
        idType: "nric" as const,
        idNumberEnc: "x",
        idNumberHmac: `cap-${i}`,
        idNumberMasked: "S****000A",
        dob: "1990-01-01",
        residencyStatus: "citizen" as const,
      });
      rows.push({
        id: w.deps.ids.newId(),
        orgId: w.orgId,
        rosterId: id,
        employeeId: e,
        date: "2026-11-23",
        kind: "rest" as const,
      });
    }
    await w.deps.db.insert(employees).values(people);
    await w.deps.db.insert(rosterShifts).values(rows);
    const r = await hr.post(`${api}/rosters/${id}/shifts`, {
      employeeId: w.crew.crewA,
      date: "2026-11-24",
      templateId: am,
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error.message).toMatch(/at most 150 employees/);
  });

  it("exports the week as CSV with paid minutes and conflicts", async () => {
    const id = await open(manager, "2026-11-02");
    const res = await manager.get(`${api}/rosters/${id}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("Employee number,Name,Date,Start,End,Break minutes,Paid minutes,Template,Conflicts");
    const a = lines.find((l) => l.includes("Lee Wei Ming") && l.includes("2026-11-02"));
    expect(a).toMatch(/,Lee Wei Ming,2026-11-02,07:00,15:00,30,450,AM,/);
    expect(lines.some((l) => l.startsWith(",Open shift,2026-11-06,07:00,15:00"))).toBe(true);
    expect((await (await w.asCrew("crewA")).get(`${api}/rosters/${id}/export.csv`)).status).toBe(403);
  });
});

describe("roster scopes", () => {
  interface ScopesView {
    locations: { id: string; name: string }[];
    rosteredLocationIds: string[];
  }

  it("lists the locations where people work rostered shifts, so an editor can open on one in use", async () => {
    // Both outlets have crew on the shift work schedule, rostered or not yet.
    const before = await ok<ScopesView>(hr.get(`${api}/scopes`));
    expect(before.rosteredLocationIds).toEqual(expect.arrayContaining([w.locationId, w.bugisId]));
    // A kiosk with nobody on shifts doesn't count, even with a roster opened; it does once it has a shift.
    const kiosk = w.deps.ids.newId();
    await w.deps.db.insert(locations).values({ id: kiosk, orgId: w.orgId, name: "Airport kiosk" });
    const id = await open(hr, "2026-12-07", kiosk);
    expect((await ok<ScopesView>(hr.get(`${api}/scopes`))).rosteredLocationIds).not.toContain(kiosk);
    await ok(hr.post(`${api}/rosters/${id}/shifts`, { employeeId: null, date: "2026-12-07", templateId: am }), 201);
    // Locations with roster shifts come first (by name: the kiosk, then HQ, rostered by the tests
    // above), then Bugis, whose crew is on the shift schedule but has no shifts yet.
    const after = await ok<ScopesView>(hr.get(`${api}/scopes`));
    expect(after.rosteredLocationIds).toEqual([kiosk, w.locationId, w.bugisId]);
  });

  it("never lists another organisation's rostered locations", async () => {
    const other = await seedOrg(w.deps, { name: "Other Café Pte. Ltd." });
    const locationId = w.deps.ids.newId();
    await w.deps.db.insert(locations).values({ id: locationId, orgId: other.id, name: "Other outlet" });
    const rosterId = w.deps.ids.newId();
    await w.deps.db
      .insert(rosters)
      .values({ id: rosterId, orgId: other.id, locationId, scopeKey: `${locationId}:*`, weekStart: "2026-12-07" });
    await w.deps.db.insert(rosterShifts).values({
      id: w.deps.ids.newId(),
      orgId: other.id,
      rosterId,
      employeeId: null,
      date: "2026-12-07",
      startsAt: new Date("2026-12-07T00:00:00Z"),
      endsAt: new Date("2026-12-07T08:00:00Z"),
    });
    const scopes = await ok<ScopesView>(hr.get(`${api}/scopes`));
    expect(scopes.rosteredLocationIds).not.toContain(locationId);
    expect(scopes.locations.map((l) => l.id)).not.toContain(locationId);
  });
});
