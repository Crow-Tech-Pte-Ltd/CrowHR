import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createCapturingMailer,
  createWorkflowWorld,
  movableClock,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { emailOutbox, notifications } from "../db/schema/notifications.ts";
import { approvalTasks } from "../db/schema/workflows.ts";
import { tick } from "../jobs/tick.ts";
import { decideTask } from "../workflows/engine.ts";
import { notify } from "./notify.ts";

describe("notifications", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-10-31T01:00:00.000Z");
  const mailer = createCapturingMailer();
  beforeEach(async () => {
    clock.set("2026-10-31T01:00:00.000Z");
    mailer.sent.length = 0;
    w = await createWorkflowWorld({ clock, mailer });
  });
  afterEach(() => w.close());

  it("a rejected claim raises the requester's unread count by one, linking to it with the comment", async () => {
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    const before = (await (await asStaff.get("/api/v1/notifications/unread-count")).json()) as { unread: number };
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 8_640 });
    const [task] = await w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, requestId));
    await decideTask(
      w.deps,
      {
        orgId: w.org.id,
        membershipId: w.m.manager.membershipId,
        roles: [],
        audit: systemAuditContext(w.org.id, "system", "t"),
      },
      { taskId: task?.id as string, decision: "reject", comment: "Please attach the Grab receipt" },
    );
    const after = (await (await asStaff.get("/api/v1/notifications/unread-count")).json()) as { unread: number };
    expect(after.unread).toBe(before.unread + 1);
    const list = (await (await asStaff.get("/api/v1/notifications")).json()) as {
      items: { id: string; title: string; body: string; link: string; readAt: string | null }[];
      unread: number;
    };
    expect(list.items[0]).toMatchObject({
      title: "Your claim request was not approved",
      body: "Wong Kai Wen: Please attach the Grab receipt",
      link: `/inbox?request=${requestId}`,
      readAt: null,
    });
    expect((await asStaff.post(`/api/v1/notifications/${list.items[0]?.id}/read`)).status).toBe(204);
    expect(
      ((await (await asStaff.get("/api/v1/notifications/unread-count")).json()) as { unread: number }).unread,
    ).toBe(0);
  });

  it("read-all clears the count; members only see their own", async () => {
    await notify(w.deps.db, w.deps, {
      orgId: w.org.id,
      recipients: [w.m.staff.membershipId, w.m.staff.membershipId, w.m.other.membershipId],
      kind: "payslip_released",
      title: "Your October payslip is ready",
      link: "/payroll",
    });
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    const list = (await (await asStaff.get("/api/v1/notifications")).json()) as { total: number };
    expect(list.total).toBe(1);
    expect(await (await asStaff.post("/api/v1/notifications/read-all")).json()).toEqual({ updated: 1 });
    // Another member's notification is a 404.
    const [others] = await w.deps.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientMembershipId, w.m.other.membershipId));
    expect((await asStaff.post(`/api/v1/notifications/${others?.id}/read`)).status).toBe(404);
  });

  it("keeps notifications for 180 days", async () => {
    await notify(w.deps.db, w.deps, {
      orgId: w.org.id,
      recipients: [w.m.staff.membershipId],
      kind: "roster_published",
      title: "Week 45 roster",
      link: "/schedules",
    });
    clock.advance(179 * 86_400_000);
    expect((await tick(w.deps)).notificationsDeleted).toBe(0);
    clock.advance(2 * 86_400_000);
    expect((await tick(w.deps)).notificationsDeleted).toBe(1);
  });

  it("respects email preferences per category; security emails are always sent", async () => {
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    expect((await asStaff.put("/api/v1/notifications/preferences", { email: { updates: false } })).status).toBe(200);
    const refuse = await asStaff.put("/api/v1/notifications/preferences", { email: { security: false } });
    expect(refuse.status).toBe(400);
    const prefs = (await (await asStaff.get("/api/v1/notifications/preferences")).json()) as {
      categories: { category: string; emailEnabled: boolean; locked: boolean }[];
    };
    expect(prefs.categories.find((c) => c.category === "updates")?.emailEnabled).toBe(false);
    expect(prefs.categories.find((c) => c.category === "security")).toMatchObject({ emailEnabled: true, locked: true });

    const email = { headline: "Hello", linkPath: "/" };
    await notify(w.deps.db, w.deps, {
      orgId: w.org.id,
      recipients: [w.m.staff.membershipId],
      kind: "payslip_released",
      title: "x",
      link: "/",
      email,
    });
    await notify(w.deps.db, w.deps, {
      orgId: w.org.id,
      recipients: [w.m.staff.membershipId],
      kind: "security_notice",
      title: "y",
      link: "/",
      email,
    });
    await notify(w.deps.db, w.deps, {
      orgId: w.org.id,
      recipients: [w.m.staff.membershipId],
      kind: "task_assigned",
      title: "z",
      link: "/",
      email,
    });
    const queued = await w.deps.db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.recipientMembershipId, w.m.staff.membershipId)));
    expect(queued.map((q) => q.kind).sort()).toEqual(["security_notice", "task_assigned"]);
  });

  it("email disabled: no outbox rows, in-app works in full, Settings says email is not configured", async () => {
    const plain = await createWorkflowWorld({ clock });
    try {
      const { requestId } = await plain.submit(plain.m.staff, "leave");
      const [task] = await plain.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, requestId));
      await decideTask(
        plain.deps,
        {
          orgId: plain.org.id,
          membershipId: plain.m.manager.membershipId,
          roles: [],
          audit: systemAuditContext(plain.org.id, "system", "t"),
        },
        { taskId: task?.id as string, decision: "approve" },
      );
      expect(await plain.deps.db.select().from(emailOutbox)).toEqual([]);
      const inApp = await plain.deps.db.select().from(notifications);
      expect(inApp.length).toBeGreaterThanOrEqual(3); // manager task, two HR tasks
      const report = await tick(plain.deps);
      expect(report.emails).toEqual({ sent: 0, retried: 0, failed: 0, suppressed: 0 });
      const asOwner = await clientAs(plain.app, plain.deps, plain.m.owner);
      const delivery = (await (await asOwner.get("/api/v1/notifications/delivery")).json()) as {
        emailConfigured: boolean;
        setupHelp: string;
      };
      expect(delivery.emailConfigured).toBe(false);
      expect(delivery.setupHelp).toMatch(/SMTP_URL/);
      const asStaff = await clientAs(plain.app, plain.deps, plain.m.staff);
      expect((await asStaff.get("/api/v1/notifications/delivery")).status).toBe(403);
    } finally {
      await plain.close();
    }
  });

  it("with a mailer, a task assignment is emailed on the next tick", async () => {
    await w.submit(w.m.staff, "leave");
    await tick(w.deps);
    expect(mailer.sent.map((m) => m.to)).toEqual(["wong@kopi.example"]);
    expect(mailer.sent[0]?.subject).toBe("Approval needed · Kampong Kopi Pte. Ltd.");
    expect(mailer.sent[0]?.text).toContain("Ravi Kumar sent a leave request that needs your approval.");
    expect(mailer.sent[0]?.text).toContain("https://hr.test/inbox?task=");
  });
});
