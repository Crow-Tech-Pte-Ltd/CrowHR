import { type AppDeps, createApp } from "@crowhr/core";
import { DEMO_START_TIME, DEMO_TODAY, type SeedClock } from "../clock.ts";
import { seedHttp } from "./http.ts";
import type { SeedResult } from "./index.ts";

/**
 * The in-browser demo opens on Saturday 31 Oct at DEMO_START_TIME (clock.ts). The cafés are open on
 * Saturdays, so by then the morning and midday crews at Tanjong Pagar and Jurong Point have clocked
 * in, Maria a few minutes late. The supervisors' closing shifts start after lunch. Attendance and
 * the employee's Clock page then show a working day instead of an empty one.
 *
 * Only the in-browser demo runs this: a demo company on a server (sample-company/seed.ts) clocks
 * every shift from 31 Oct up to its real today itself. Tiong Bahru is left out on purpose: its
 * October joiner's days worked come from his clock-ins, and October's draft run is already computed.
 */
const MORNING_CREW: readonly { who: string; minutesLate: number }[] = [
  { who: "employee", minutesLate: -4 }, // Jun Jie, Tanjong Pagar, 08:00
  { who: "pt1", minutesLate: 0 }, // Hui Min, Tanjong Pagar, 10:00
  { who: "barista2", minutesLate: 2 }, // Hafiz, Jurong Point, 08:00
  { who: "spass", minutesLate: 14 }, // Maria, Jurong Point, 10:00
];

interface MyShift {
  id: string;
  date: string;
  kind: "shift" | "rest";
  start: string | null;
}

export async function seedSaturdayMorning(deps: AppDeps, clock: SeedClock, origin: string, seeded: SeedResult) {
  const http = seedHttp(createApp(deps), origin, () => clock.now().getTime());
  const opensAt = Date.parse(`${DEMO_TODAY}T${DEMO_START_TIME}:00+08:00`);
  const punches: { who: string; shiftId: string; at: number }[] = [];
  for (const { who, minutesLate } of MORNING_CREW) {
    const membershipId = seeded.members[who];
    if (!membershipId) throw new Error(`No seeded member ${who}`);
    const mine = await (await http.as(membershipId)).get<{ shifts: MyShift[] }>(
      `/api/v1/scheduling/me?from=${DEMO_TODAY}&to=${DEMO_TODAY}`,
    );
    const shift = mine.shifts.find((s) => s.kind === "shift" && s.date === DEMO_TODAY && s.start);
    if (!shift?.start) throw new Error(`${who} has no shift on ${DEMO_TODAY}`);
    const startsAt = /^\d{2}:\d{2}$/.test(shift.start)
      ? Date.parse(`${DEMO_TODAY}T${shift.start}:00+08:00`)
      : Date.parse(shift.start);
    const at = startsAt + minutesLate * 60_000;
    if (at >= opensAt) throw new Error(`${who}'s shift starts after the demo opens`);
    punches.push({ who, shiftId: shift.id, at });
  }
  for (const p of punches.sort((a, b) => a.at - b.at)) {
    clock.set(new Date(p.at + 8 * 3600_000).toISOString().slice(0, 16));
    const at = new Date(p.at).toISOString();
    await (await http.as(seeded.members[p.who] as string)).post("/api/v1/attendance/punches", {
      kind: "in",
      idempotencyKey: `seed-${p.shiftId}-in`,
      deviceTime: at,
      sentAt: at,
      queued: false,
      source: "web",
      location: null,
    });
  }
}
