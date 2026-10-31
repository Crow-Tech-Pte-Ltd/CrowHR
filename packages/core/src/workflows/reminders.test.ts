import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPeopleDatesDouble,
  createWorkflowWorld,
  EMP,
  movableClock,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { notifications, remindersSent } from "../db/schema/notifications.ts";
import { tick } from "../jobs/tick.ts";
import { currentThreshold } from "./reminders.ts";

const MIN = 60_000;
const DAY = 1440 * MIN;
const PASS = "00000000-0000-7000-8000-00000000cc01";

describe("reminders", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-10-31T01:00:00.000Z");
  const people = createPeopleDatesDouble();
  beforeEach(async () => {
    clock.set("2026-10-31T01:00:00.000Z");
    people.passes.length = 0;
    people.probations.length = 0;
    w = await createWorkflowWorld({ clock, peopleDates: people });
  });
  afterEach(() => w.close());

  const sent = () => w.deps.db.select().from(remindersSent);
  const notesFor = (membershipId: string, kind: string) =>
    w.deps.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientMembershipId, membershipId), eq(notifications.kind, kind)));

  it("picks the most urgent threshold reached", () => {
    expect(currentThreshold("2026-10-31", "2027-02-01", [90, 60, 30, 7, 0])).toBeNull();
    expect(currentThreshold("2026-10-31", "2027-01-29", [90, 60, 30, 7, 0])).toBe(90);
    expect(currentThreshold("2026-10-31", "2026-11-20", [90, 60, 30, 7, 0])).toBe(30);
    expect(currentThreshold("2026-10-31", "2026-10-31", [90, 60, 30, 7, 0])).toBe(0);
  });

  it("work pass expiry: 90, 60, 30, 7 and 0 days before, to hr_admins, once each", async () => {
    people.passes.push({
      orgId: w.org.id,
      passId: PASS,
      employeeId: EMP.other,
      employeeName: "Siti Rahmah",
      passType: "S Pass",
      expiresOn: "2027-01-29", // 90 days after 31 Oct 2026
    });
    for (let d = 0; d <= 92; d++) {
      await tick(w.deps);
      clock.advance(DAY);
    }
    expect((await sent()).map((r) => r.threshold)).toEqual(["d90", "d60", "d30", "d7", "d0"]);
    const hr = await notesFor(w.m.hr.membershipId, "work_pass_expiry");
    expect(hr.map((n) => n.title)).toEqual([
      "Siti Rahmah's S Pass expires on 29 Jan 2027",
      "Siti Rahmah's S Pass expires on 29 Jan 2027",
      "Siti Rahmah's S Pass expires on 29 Jan 2027",
      "Siti Rahmah's S Pass expires on 29 Jan 2027",
      "Siti Rahmah's S Pass expires today",
    ]);
    expect(await notesFor(w.m.hr2.membershipId, "work_pass_expiry")).toHaveLength(5);
    expect(await notesFor(w.m.staff.membershipId, "work_pass_expiry")).toHaveLength(0);
  });

  it("exactly one 30-day reminder across 1 440 ticks on the day the threshold is reached", async () => {
    people.passes.push({
      orgId: w.org.id,
      passId: PASS,
      employeeId: EMP.other,
      employeeName: "Siti Rahmah",
      passType: "Work Permit",
      expiresOn: "2026-11-30",
    });
    clock.set("2026-10-30T16:00:00.000Z"); // 31 Oct 00:00 SGT, 30 days before
    for (let i = 0; i < 1440; i++) {
      await tick(w.deps);
      clock.advance(MIN);
    }
    const rows = await sent();
    expect(rows.map((r) => r.threshold)).toEqual(["d30"]);
    expect(await notesFor(w.m.hr.membershipId, "work_pass_expiry")).toHaveLength(1);
  }, 120_000);

  it("work pass renewed after the 30-day reminder: no 7-day or expiry-day reminder for the old pass", async () => {
    people.passes.push({
      orgId: w.org.id,
      passId: PASS,
      employeeId: EMP.other,
      employeeName: "Siti Rahmah",
      passType: "S Pass",
      expiresOn: "2026-11-30",
    });
    await tick(w.deps);
    expect((await sent()).map((r) => r.threshold)).toEqual(["d30"]);
    // HR adds the renewed pass: the old one is no longer current.
    people.passes.length = 0;
    people.passes.push({
      orgId: w.org.id,
      passId: "00000000-0000-7000-8000-00000000cc02",
      employeeId: EMP.other,
      employeeName: "Siti Rahmah",
      passType: "S Pass",
      expiresOn: "2028-11-30",
    });
    for (let d = 0; d < 35; d++) {
      clock.advance(DAY);
      await tick(w.deps);
    }
    expect((await sent()).map((r) => `${r.subjectKey}:${r.threshold}`)).toEqual([`${PASS}:d30`]);
  });

  it("probation end: 14 days before, to the manager and hr_admins; stops when confirmed", async () => {
    people.probations.push({
      orgId: w.org.id,
      employeeId: EMP.staff,
      employeeName: "Ravi Kumar",
      endsOn: "2026-11-20",
    });
    people.probations.push({
      orgId: w.org.id,
      employeeId: EMP.other,
      employeeName: "Siti Rahmah",
      endsOn: "2026-11-25",
    });
    for (let d = 0; d < 8; d++) {
      await tick(w.deps);
      clock.advance(DAY);
    }
    // 31 Oct – 7 Nov: Ravi's reminder went out on 6 Nov; Siti's probation is confirmed before 11 Nov.
    expect(await notesFor(w.m.manager.membershipId, "probation_end")).toHaveLength(1);
    expect(await notesFor(w.m.hr.membershipId, "probation_end")).toHaveLength(1);
    expect(await notesFor(w.m.head.membershipId, "probation_end")).toHaveLength(0);
    people.probations.splice(1, 1);
    for (let d = 0; d < 20; d++) {
      await tick(w.deps);
      clock.advance(DAY);
    }
    expect((await sent()).map((r) => r.subjectKey)).toEqual([`${EMP.staff}:2026-11-20`]);
  });

  it("without the people module, these reminders are inactive", async () => {
    const plain = await createWorkflowWorld({ clock });
    try {
      expect((await tick(plain.deps)).reminders).toBe(0);
    } finally {
      await plain.close();
    }
  });
});
