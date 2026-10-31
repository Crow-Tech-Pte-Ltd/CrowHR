import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCapturingMailer,
  createFakeSubjects,
  createPeopleDatesDouble,
  createTestDeps,
  createWorkflowWorld,
  EMP,
  movableClock,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { memberships } from "../db/schema/access.ts";
import { notifications } from "../db/schema/notifications.ts";
import { approvalTasks } from "../db/schema/workflows.ts";
import type { Transition } from "../workflows/types.ts";
import { createManualScheduler } from "./scheduler.ts";
import { tick } from "./tick.ts";

const DAY = 86_400_000;

describe("tick(now)", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-11-02T01:00:00.000Z");
  const mailer = createCapturingMailer();
  const people = createPeopleDatesDouble();
  let transitionRuns = 0;
  const formerTransition: Transition = {
    id: "membership_former",
    async run(db, { now }) {
      transitionRuns++;
      // Example: a module marks members whose last day has passed as former.
      const rows = await db
        .update(memberships)
        .set({ status: "former", updatedAt: now })
        .where(and(eq(memberships.status, "suspended")))
        .returning({ id: memberships.id });
      return rows.length;
    },
  };
  beforeEach(async () => {
    clock.set("2026-11-02T01:00:00.000Z");
    mailer.sent.length = 0;
    transitionRuns = 0;
    people.passes.length = 0;
    w = await createWorkflowWorld({
      clock,
      mailer,
      peopleDates: people,
      workflowPlugins: [createFakeSubjects().plugin, { name: "lifecycle", transitions: [formerTransition] }],
    });
  });
  afterEach(() => w.close());

  it("is idempotent: ticking again does nothing new", async () => {
    await w.submit(w.m.staff, "leave");
    const first = await tick(w.deps);
    expect(first.emails.sent).toBe(1);
    const second = await tick(w.deps);
    expect(second).toMatchObject({ escalations: 0, reminders: 0, emails: { sent: 0 } });
    expect(mailer.sent).toHaveLength(1);
  });

  it("two replicas ticking at once on the same database never double-process (SKIP LOCKED + unique keys)", async () => {
    people.passes.push({
      orgId: w.org.id,
      passId: "00000000-0000-7000-8000-00000000bb01",
      employeeId: EMP.staff,
      employeeName: "Ravi Kumar",
      passType: "S Pass",
      expiresOn: "2026-12-01",
    });
    const { requestId } = await w.submit(w.m.staff, "leave");
    clock.advance(4 * DAY);
    const replica = {
      ...createTestDeps(w.deps.db, { clock, mailer, peopleDates: people }),
      workflowPlugins: w.deps.workflowPlugins,
      approverDirectory: w.deps.approverDirectory,
    };
    const [a, b] = await Promise.all([tick(w.deps), tick(replica)]);
    expect(a.escalations + b.escalations).toBe(1);
    expect(a.reminders + b.reminders).toBe(1);
    const escalated = await w.deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.origin, "escalated")));
    expect(escalated).toHaveLength(1);
    const sentTo = mailer.sent.map((m) => `${m.to}|${m.subject}`);
    expect(new Set(sentTo).size).toBe(sentTo.length);
  });

  it("catches up after a 2-day gap: everything due in between, once each", async () => {
    const leave = await w.submit(w.m.staff, "leave");
    clock.advance(DAY);
    people.passes.push({
      orgId: w.org.id,
      passId: "00000000-0000-7000-8000-00000000bb02",
      employeeId: EMP.other,
      employeeName: "Siti Rahmah",
      passType: "Work Permit",
      expiresOn: "2026-12-04", // 31 days from 3 Nov; 30-day threshold falls on 4 Nov
    });
    // Down from 3 Nov to 5 Nov.
    clock.advance(2 * DAY + 60_000);
    const report = await tick(w.deps);
    expect(report.escalations).toBe(1);
    expect(report.reminders).toBe(1);
    expect((await tick(w.deps)).reminders).toBe(0);
    const tasks = await w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, leave.requestId));
    expect(tasks.filter((t) => t.origin === "escalated")).toHaveLength(1);
  });

  it("runs registered transitions and isolates failing sweeps", async () => {
    await w.deps.db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, w.m.loner.membershipId));
    const broken = {
      ...w.deps,
      peopleDates: {
        workPassesExpiring: async () => {
          throw new Error("people module down");
        },
        probationsEnding: async () => [],
      },
    };
    const report = await tick(broken);
    expect(transitionRuns).toBe(1);
    expect(report.transitions).toEqual({ membership_former: 1 });
    expect(report.errors).toEqual([]);
    const [m] = await w.deps.db.select().from(memberships).where(eq(memberships.id, w.m.loner.membershipId));
    expect(m?.status).toBe("former");
  });

  it("the manual scheduler (tests, demo) serialises ticks", async () => {
    const scheduler = createManualScheduler(w.deps);
    scheduler.start();
    expect(scheduler.running).toBe(true);
    await w.submit(w.m.staff, "leave");
    const [x, y] = await Promise.all([scheduler.tick(), scheduler.tick()]);
    expect(x.emails.sent + y.emails.sent).toBe(1);
    await scheduler.stop();
    expect(scheduler.running).toBe(false);
    const n = await w.deps.db.select().from(notifications);
    expect(n.length).toBeGreaterThan(0);
  });
});
