import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import {
  createSchedulingWorld,
  decideAll,
  notificationTitles,
  ok,
  type SchedulingWorld,
} from "../../testing/scheduling.ts";
import { publishedShifts, rosterShifts, rosters } from "../db/schema/scheduling.ts";
import { tick } from "../jobs/tick.ts";

/** Shift swaps, give-aways and open-shift pickup (spec "Shift swaps and open shifts"). */
let w: SchedulingWorld;
let manager: TestClient;
let ali: TestClient; // Lee Wei Ming
let mei: TestClient; // Nurul Huda
let rosterId: string;
const api = "/api/v1/scheduling";
const ids: Record<string, string> = {};

interface Swap {
  id: string;
  status: string;
  direction: string;
  kind: string;
}

const holder = async (shiftId: string) => {
  const [p] = await w.deps.db.select().from(publishedShifts).where(eq(publishedShifts.id, shiftId));
  const [r] = await w.deps.db.select().from(rosterShifts).where(eq(rosterShifts.id, shiftId));
  return { published: p?.employeeId ?? null, working: r?.employeeId ?? null };
};

beforeAll(async () => {
  w = await createSchedulingWorld();
  manager = await w.as("manager");
  ali = await w.asCrew("crewA");
  mei = await w.asCrew("crewB");
  rosterId = (
    await ok<{ id: string }>(manager.post(`${api}/rosters`, { weekStart: "2026-11-09", locationId: w.locationId }))
  ).id;
  const add = async (key: string, employeeId: string | null, date: string, startTime: string, endTime: string) => {
    ids[key] = (
      await ok<{ id: string }>(
        manager.post(`${api}/rosters/${rosterId}/shifts`, { employeeId, date, startTime, endTime, breakMinutes: 30 }),
        201,
      )
    ).id;
  };
  await add("aliFri", w.crew.crewA, "2026-11-13", "07:00", "15:00");
  await add("meiSat", w.crew.crewB, "2026-11-14", "15:00", "23:00");
  await add("aliMon", w.crew.crewA, "2026-11-09", "07:00", "15:00");
  await add("aliTue", w.crew.crewA, "2026-11-10", "07:00", "15:00");
  await add("aliWed", w.crew.crewA, "2026-11-11", "07:00", "15:00");
  await add("open", null, "2026-11-12", "11:00", "19:00");
  await ok(manager.post(`${api}/rosters/${rosterId}/publish`, {}));
}, 60_000);
afterAll(() => w.close());

describe("shift swaps", () => {
  it("Ali swaps his Friday for Mei's Saturday: Mei accepts, the manager approves, both copies change atomically", async () => {
    const sent = await ok<Swap>(
      ali.post(`${api}/swaps`, {
        kind: "swap",
        shiftId: ids.aliFri,
        peerEmployeeId: w.crew.crewB,
        peerShiftId: ids.meiSat,
      }),
      201,
    );
    expect(sent).toMatchObject({ status: "pending_peer", direction: "outgoing" });
    expect(await notificationTitles(w.deps, w.cm.crewB.membershipId)).toContain(
      "Lee Wei Ming asked to swap shifts with you: their Fri 13 Nov 2026 for your Sat 14 Nov 2026",
    );
    const home = await ok<{ items: { source: string; title: string }[] }>(mei.get("/api/v1/inbox"));
    expect(home.items.find((i) => i.source === "shift_swap_offers")?.title).toBe(
      "Swap your Sat 14 Nov for Lee Wei Ming's Fri 13 Nov?",
    );
    // A second request on the same shift is refused while this one is open.
    expect(
      (await ali.post(`${api}/swaps`, { kind: "giveaway", shiftId: ids.aliFri, peerEmployeeId: w.crew.crewC })).status,
    ).toBe(409);
    const accepted = await ok<Swap>(mei.post(`${api}/swaps/${sent.id}/accept`));
    expect(accepted.status).toBe("pending_approval");
    const tasks = await ok<{ items: { subjectType: string; title: string }[] }>(manager.get("/api/v1/approvals/tasks"));
    expect(tasks.items.find((t) => t.subjectType === "shift_swap")?.title).toBe("Shift swap, Fri 13 Nov ↔ Sat 14 Nov");
    const [before] = await w.deps.db.select().from(rosters).where(eq(rosters.id, rosterId));
    const [d] = await decideAll(manager, "shift_swap");
    expect(d?.status).toBe(200);
    expect(await holder(ids.aliFri as string)).toEqual({ published: w.crew.crewB, working: w.crew.crewB });
    expect(await holder(ids.meiSat as string)).toEqual({ published: w.crew.crewA, working: w.crew.crewA });
    const [after] = await w.deps.db.select().from(rosters).where(eq(rosters.id, rosterId));
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect(await notificationTitles(w.deps, w.cm.crewB.membershipId)).toContain(
      "Shift swap approved: you now work Fri 13 Nov 2026, 07:00–15:00",
    );
    const me = await ok<{ shifts: { date: string }[] }>(ali.get(`${api}/me?from=2026-11-09&to=2026-11-15`));
    expect(me.shifts.map((s) => s.date)).toContain("2026-11-14");
    expect(me.shifts.map((s) => s.date)).not.toContain("2026-11-13");
  });

  it("a give-away whose colleague got an overlapping shift after accepting fails approval and changes nothing", async () => {
    const sent = await ok<Swap>(
      ali.post(`${api}/swaps`, { kind: "giveaway", shiftId: ids.aliMon, peerEmployeeId: w.crew.crewB }),
      201,
    );
    await ok(mei.post(`${api}/swaps/${sent.id}/accept`));
    // The manager then rosters Mei 10:00–14:00 on Monday in another roster (the Bugis outlet has none of hers,
    // so put it in this roster's working copy directly; the save itself does not touch Ali's shift).
    await ok(
      manager.post(`${api}/rosters/${rosterId}/shifts`, {
        employeeId: w.crew.crewB,
        date: "2026-11-09",
        startTime: "10:00",
        endTime: "14:00",
        breakMinutes: 0,
      }),
      201,
    );
    const [d] = await decideAll(manager, "shift_swap");
    expect(d?.status).toBe(409);
    expect(JSON.stringify(d?.body)).toMatch(/Nurul Huda already works 10:00–14:00 on Mon 9 Nov 2026/);
    expect(await holder(ids.aliMon as string)).toEqual({ published: w.crew.crewA, working: w.crew.crewA });
    const mine = await ok<{ items: Swap[] }>(ali.get(`${api}/swaps`));
    expect(mine.items.find((s) => s.id === sent.id)?.status).toBe("pending_approval");
    // The requester can still cancel it; its approval is withdrawn.
    expect((await ok<Swap>(ali.post(`${api}/swaps/${sent.id}/cancel`))).status).toBe("cancelled");
    expect((await ok<{ items: { subjectType: string }[] }>(manager.get("/api/v1/approvals/tasks"))).items).toEqual([]);
  });

  it("decline, and editing a shift cancels its open request", async () => {
    const a = await ok<Swap>(
      ali.post(`${api}/swaps`, { kind: "giveaway", shiftId: ids.aliTue, peerEmployeeId: w.crew.crewB }),
      201,
    );
    expect((await ok<Swap>(mei.post(`${api}/swaps/${a.id}/decline`))).status).toBe("declined");
    expect(await notificationTitles(w.deps, w.cm.crewA.membershipId)).toContain(
      "Nurul Huda declined your shift give-away",
    );
    const b = await ok<Swap>(
      ali.post(`${api}/swaps`, { kind: "giveaway", shiftId: ids.aliTue, peerEmployeeId: w.crew.crewB }),
      201,
    );
    expect((await mei.post(`${api}/swaps/${b.id}/cancel`)).status).toBe(404); // not hers to cancel
    expect((await ali.post(`${api}/swaps/${b.id}/accept`)).status).toBe(404); // not his to accept
    // Moving the shift cancels the request and tells both of them.
    await ok(
      manager.patch(`${api}/shifts/${ids.aliTue}`, {
        employeeId: w.crew.crewA,
        date: "2026-11-10",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
      }),
    );
    const mine = await ok<{ items: Swap[] }>(ali.get(`${api}/swaps`));
    expect(mine.items.find((s) => s.id === b.id)?.status).toBe("cancelled");
    const notice = "A shift swap request was cancelled: the shift was changed on the roster.";
    expect(await notificationTitles(w.deps, w.cm.crewB.membershipId)).toContain(notice);
    // Until the roster is published again, the changed shift can't be offered.
    const again = await ali.post(`${api}/swaps`, {
      kind: "giveaway",
      shiftId: ids.aliTue,
      peerEmployeeId: w.crew.crewB,
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.message).toMatch(/changed on the roster since it was published/);
  });

  it("someone else's shift cannot be offered", async () => {
    const r = await mei.post(`${api}/swaps`, { kind: "giveaway", shiftId: ids.aliWed, peerEmployeeId: w.crew.crewC });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("stale");
    expect((await (await w.as("owner")).post(`${api}/swaps`, { kind: "pickup", shiftId: ids.open })).status).toBe(403);
  });

  it("an open shift is picked up through approval", async () => {
    const r = await ok<Swap>(mei.post(`${api}/swaps`, { kind: "pickup", shiftId: ids.open }), 201);
    expect(r.status).toBe("pending_approval");
    const me = await ok<{ openShifts: { id: string; pendingSwap: boolean }[] }>(
      mei.get(`${api}/me?from=2026-11-09&to=2026-11-15`),
    );
    expect(me.openShifts.some((s) => s.id === ids.open)).toBe(false); // already requested
    const [d] = await decideAll(manager, "shift_swap");
    expect(d?.status).toBe(200);
    expect(await holder(ids.open as string)).toEqual({ published: w.crew.crewB, working: w.crew.crewB });
  });

  it("an open request expires when the shift starts (tick)", async () => {
    const r = await ok<Swap>(
      ali.post(`${api}/swaps`, { kind: "giveaway", shiftId: ids.aliWed, peerEmployeeId: w.crew.crewC }),
      201,
    );
    w.clock.set("2026-11-11T00:00:00.000Z"); // 08:00 SGT on Wed 11 Nov: the 07:00 shift has started
    await tick(w.deps, w.clock.now());
    const mine = await ok<{ items: Swap[] }>((await w.asCrew("crewA")).get(`${api}/swaps`));
    expect(mine.items.find((s) => s.id === r.id)?.status).toBe("expired");
    const [row] = await w.deps.db
      .select()
      .from(publishedShifts)
      .where(and(eq(publishedShifts.id, ids.aliWed as string), eq(publishedShifts.employeeId, w.crew.crewA)));
    expect(row).toBeDefined();
  });
});
