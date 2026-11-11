import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { attendancePunches } from "../db/schema/attendance.ts";
import { DEFAULT_PDPA_NOTICE } from "./settings.ts";

/** Punches (spec "Punches with device and server time", "Location and network controls"). */
describe("attendance punches", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    // Thursday 12 Nov 2026, 09:20 SGT.
    w = await createLeaveWorld({ now: "2026-11-12T01:20:00.000Z" });
  });
  afterEach(() => w.close());

  const HQ = { latitude: 1.2764, longitude: 103.8458 };
  const settings = (over: Record<string, unknown>) => ({
    locationMode: "off",
    offices: [],
    locationEnforcement: "flag",
    allowedIps: [],
    ipEnforcement: "flag",
    pdpaNotice: null,
    defaultStartTime: "09:00",
    scheduleStartTimes: {},
    breakMinutes: 60,
    lateGraceMinutes: 5,
    earlyOutGraceMinutes: 5,
    skewThresholdSeconds: 120,
    otBlockMinutes: 15,
    otMinimumMinutes: 30,
    ...over,
  });
  const configure = async (over: Record<string, unknown>) => {
    const res = await (await w.as("owner")).put("/api/v1/attendance/settings", settings(over));
    expect(res.status, await res.clone().text()).toBe(200);
  };

  it("an offline punch replays with its tap time, server time and a late-sync flag; a retry is not duplicated", async () => {
    const staff = await w.as("staff");
    const key = "device-1:2026-11-12T00:58";
    const first = await punch(staff, "in", "2026-11-12T00:58:00.000Z", {
      sentAt: "2026-11-12T01:20:00.000Z",
      queued: true,
      key,
    });
    expect(first.status).toBe(201);
    const body = (await first.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      recordedAt: "2026-11-12T00:58:00.000Z",
      serverTime: "2026-11-12T01:20:00.000Z",
      deviceTime: "2026-11-12T00:58:00.000Z",
      workDate: "2026-11-12",
      skewSeconds: 0,
      queued: true,
      flags: ["late_sync"],
      status: "flagged",
      replayed: false,
    });
    const retry = await punch(staff, "in", "2026-11-12T00:58:00.000Z", {
      sentAt: "2026-11-12T01:20:05.000Z",
      queued: true,
      key,
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: body.id, replayed: true });
    const rows = await w.deps.db.select().from(attendancePunches).where(eq(attendancePunches.employeeId, w.emp.staff));
    expect(rows).toHaveLength(1);
  });

  it("a fast device clock is corrected to server time and flagged; a slow clock on a queued punch is corrected too", async () => {
    const staff = await w.as("staff");
    // 15 minutes fast, sent immediately.
    const fast = await punch(staff, "in", "2026-11-12T01:35:00.000Z");
    expect(await fast.json()).toMatchObject({
      recordedAt: "2026-11-12T01:20:00.000Z",
      deviceTime: "2026-11-12T01:35:00.000Z",
      skewSeconds: -900,
      flags: ["clock_skew"],
    });
    // 10 minutes slow: tapped at a real 08:50 (device 08:40), queued, sent at a real 09:20 (device 09:10).
    const slow = await punch(staff, "out", "2026-11-12T00:40:00.000Z", {
      sentAt: "2026-11-12T01:10:00.000Z",
      queued: true,
    });
    expect(await slow.json()).toMatchObject({
      recordedAt: "2026-11-12T00:50:00.000Z",
      skewSeconds: 600,
      flags: ["clock_skew", "late_sync"],
    });
  });

  it("native apps: elapsed time since the tap fixes the time even when the phone's clock was changed while offline", async () => {
    const staff = await w.as("staff");
    // Tapped at a real 08:50 SGT; the employee then moved the phone's clock back an hour, and the
    // app sent the punch 30 minutes later. The monotonic elapsed time (30 min) gives the real tap.
    const res = await punch(staff, "in", "2026-11-12T00:50:00.000Z", {
      sentAt: "2026-11-12T00:20:00.000Z",
      queued: true,
      elapsedMs: 30 * 60_000,
      source: "android",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await res.json()).toMatchObject({
      recordedAt: "2026-11-12T00:50:00.000Z",
      deviceTime: "2026-11-12T00:50:00.000Z",
      source: "android",
      skewSeconds: 0,
      flags: ["late_sync"],
    });
    // Without elapsed time the same request is taken at its word: tap = send − 0, an hour off.
    const naive = await punch(staff, "out", "2026-11-12T00:50:00.000Z", {
      sentAt: "2026-11-12T00:20:00.000Z",
      queued: true,
      source: "ios",
    });
    expect(naive.status).toBe(422);
  });

  it("native apps: a device clock that disagrees with the elapsed time is flagged as clock skew", async () => {
    const staff = await w.as("staff");
    // Sent immediately (elapsed 0) but the device says 08:00: its clock is 80 minutes slow.
    const res = await punch(staff, "in", "2026-11-12T00:00:00.000Z", {
      sentAt: "2026-11-12T00:00:00.000Z",
      elapsedMs: 0,
      source: "ios",
    });
    expect(await res.json()).toMatchObject({
      recordedAt: "2026-11-12T01:20:00.000Z",
      skewSeconds: 4800,
      flags: ["clock_skew"],
      source: "ios",
    });
  });

  it("refuses punches more than 7 days old, tapped after sending, or with no employee record", async () => {
    const staff = await w.as("staff");
    const old = await punch(staff, "in", "2026-11-04T00:00:00.000Z", {
      sentAt: "2026-11-12T01:20:00.000Z",
      queued: true,
    });
    expect(old.status).toBe(422);
    expect(((await old.json()) as { error: { code: string; message: string } }).error).toMatchObject({
      code: "punch_rejected",
      message: expect.stringMatching(/more than 7 days old/),
    });
    const after = await punch(staff, "in", "2026-11-12T01:30:00.000Z", { sentAt: "2026-11-12T01:20:00.000Z" });
    expect(after.status).toBe(422);
    const owner = await w.as("owner");
    expect((await punch(owner, "in", "2026-11-12T01:20:00.000Z")).status).toBe(403);
  });

  it("stores no location when collection is off, and shows the PDPA notice only when it is on", async () => {
    const staff = await w.as("staff");
    const me = (await (await staff.get("/api/v1/attendance/me")).json()) as {
      location: { mode: string; pdpaNotice: string | null };
    };
    expect(me.location).toMatchObject({ mode: "off", pdpaNotice: null });
    const res = await punch(staff, "in", "2026-11-12T01:20:00.000Z", { location: HQ });
    expect(((await res.json()) as { location: unknown }).location).toBeNull();
    const [row] = await w.deps.db.select().from(attendancePunches).where(eq(attendancePunches.employeeId, w.emp.staff));
    expect([row?.latitude, row?.longitude]).toEqual([null, null]);
    await configure({ locationMode: "optional" });
    const after = (await (await staff.get("/api/v1/attendance/me")).json()) as {
      clockedIn: boolean;
      location: { pdpaNotice: string | null };
      today: unknown[];
    };
    expect(after.location.pdpaNotice).toBe(DEFAULT_PDPA_NOTICE);
    expect(after.clockedIn).toBe(true);
    expect(after.today).toHaveLength(1);
  });

  it("blocks a punch 1 km from the office in block mode, and flags it in flag mode", async () => {
    await configure({
      locationMode: "required",
      offices: [{ name: "Tanjong Pagar HQ", ...HQ, radiusMetres: 200 }],
      locationEnforcement: "block",
    });
    const staff = await w.as("staff");
    const far = await punch(staff, "in", "2026-11-12T01:20:00.000Z", {
      location: { latitude: HQ.latitude + 0.009, longitude: HQ.longitude, accuracyMetres: 15 },
    });
    expect(far.status).toBe(422);
    const err = ((await far.json()) as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("outside_location");
    expect(err.message).toMatch(/1\.0 km from Tanjong Pagar HQ/);
    const none = await punch(staff, "in", "2026-11-12T01:20:00.000Z");
    expect(none.status).toBe(422);
    const near = await punch(staff, "in", "2026-11-12T01:20:00.000Z", {
      location: { latitude: HQ.latitude + 0.001, longitude: HQ.longitude, accuracyMetres: 10 },
    });
    expect(near.status).toBe(201);
    expect(((await near.json()) as { location: { accuracyMetres: number } }).location.accuracyMetres).toBe(10);

    await configure({
      locationMode: "required",
      offices: [{ name: "Tanjong Pagar HQ", ...HQ, radiusMetres: 200 }],
      locationEnforcement: "flag",
    });
    const flagged = await punch(staff, "out", "2026-11-12T01:20:00.000Z", {
      location: { latitude: HQ.latitude + 0.009, longitude: HQ.longitude },
    });
    expect(flagged.status).toBe(201);
    expect(((await flagged.json()) as { flags: string[] }).flags).toEqual(["outside_location"]);
    const noLoc = await punch(staff, "out", "2026-11-12T01:20:00.000Z");
    expect(((await noLoc.json()) as { flags: string[] }).flags).toEqual(["no_location"]);

    // Blocked without a location: the web, iOS and Android apps show this message as is.
    await configure({
      locationMode: "required",
      offices: [{ name: "Tanjong Pagar HQ", ...HQ, radiusMetres: 200 }],
      locationEnforcement: "block",
    });
    const blocked = await punch(staff, "out", "2026-11-12T01:20:00.000Z");
    expect(blocked.status).toBe(422);
    const error = ((await blocked.json()) as { error: { code: string; message: string; details: unknown } }).error;
    expect(error).toMatchObject({ code: "outside_location", details: { reason: "no_location" } });
    expect(error.message).toBe(
      "Your company needs your location to clock in. Allow location for Crow HR in your browser or phone settings, then clock in again.",
    );
  });

  it("allowed IP ranges flag or block other networks", async () => {
    await configure({ allowedIps: ["203.0.113.0/24", "2001:db8::/32"], ipEnforcement: "block" });
    const staff = await w.as("staff");
    const away = await punch(staff, "in", "2026-11-12T01:20:00.000Z", {
      headers: { "x-crowhr-client-ip": "198.51.100.7" },
    });
    expect(away.status).toBe(422);
    expect(((await away.json()) as { error: { code: string } }).error.code).toBe("ip_not_allowed");
    const office = await punch(staff, "in", "2026-11-12T01:20:00.000Z", {
      headers: { "x-crowhr-client-ip": "203.0.113.20" },
    });
    expect(office.status).toBe(201);
    const v6 = await punch(staff, "out", "2026-11-12T01:20:00.000Z", {
      headers: { "x-crowhr-client-ip": "2001:db8::42" },
    });
    expect(v6.status).toBe(201);
    await configure({ allowedIps: ["203.0.113.0/24"], ipEnforcement: "flag" });
    const flagged = await punch(staff, "in", "2026-11-12T01:20:00.000Z", {
      headers: { "x-crowhr-client-ip": "198.51.100.7" },
    });
    expect(((await flagged.json()) as { flags: string[] }).flags).toEqual(["ip_not_allowed"]);
    // Invalid ranges are refused with a fix-it message.
    const bad = await (await w.as("owner")).put(
      "/api/v1/attendance/settings",
      settings({ allowedIps: ["office wifi"] }),
    );
    expect(bad.status).toBe(400);
  });

  it("an out before 04:00 closes the previous day's shift", async () => {
    w.clock.set("2026-11-12T18:30:00.000Z"); // 02:30 SGT on 13 Nov
    const staff = await w.as("staff");
    await punch(staff, "in", "2026-11-12T14:00:00.000Z", { sentAt: "2026-11-12T18:30:00.000Z", queued: true }); // 22:00 SGT
    const out = await punch(staff, "out", "2026-11-12T18:00:00.000Z", {
      sentAt: "2026-11-12T18:30:00.000Z",
      queued: true,
    }); // 02:00 SGT
    expect(((await out.json()) as { workDate: string }).workDate).toBe("2026-11-12");
  });

  it("only owners and HR admins read or change the settings", async () => {
    expect((await (await w.as("staff")).get("/api/v1/attendance/settings")).status).toBe(403);
    expect((await (await w.as("manager")).put("/api/v1/attendance/settings", settings({}))).status).toBe(403);
    const hr = await w.as("hr");
    const got = (await (await hr.get("/api/v1/attendance/settings")).json()) as {
      defaultStartTime: string;
      effectivePdpaNotice: string;
    };
    expect(got).toMatchObject({ defaultStartTime: "09:00", effectivePdpaNotice: DEFAULT_PDPA_NOTICE });
  });
});

describe("today's punches on the clock screen", () => {
  it("after midnight, yesterday's closed shift is not today's; an open overnight shift still is", async () => {
    // Wednesday 11 Nov 2026, 21:00–23:30 SGT, then 00:30 on Thursday.
    const w = await createLeaveWorld({ now: "2026-11-11T13:00:00.000Z" });
    try {
      const staff = await w.as("staff");
      await punch(staff, "in", "2026-11-11T13:00:00.000Z");
      w.clock.set("2026-11-11T15:30:00.000Z");
      expect((await punch(await w.as("staff"), "out", "2026-11-11T15:30:00.000Z")).status).toBe(201);
      w.clock.set("2026-11-11T16:30:00.000Z"); // 00:30 SGT Thursday
      const me = async () =>
        (await (await (await w.as("staff")).get("/api/v1/attendance/me")).json()) as {
          clockedIn: boolean;
          today: { workDate: string }[];
        };
      expect(await me()).toMatchObject({ clockedIn: false, today: [] });
      // An overnight shift still open after midnight keeps its punches on the screen.
      w.clock.set("2026-11-12T13:00:00.000Z"); // 21:00 Thursday
      await punch(await w.as("staff"), "in", "2026-11-12T13:00:00.000Z");
      w.clock.set("2026-11-12T17:00:00.000Z"); // 01:00 Friday
      const open = await me();
      expect(open.clockedIn).toBe(true);
      expect(open.today.map((p) => p.workDate)).toEqual(["2026-11-12"]);
    } finally {
      await w.close();
    }
  });
});
