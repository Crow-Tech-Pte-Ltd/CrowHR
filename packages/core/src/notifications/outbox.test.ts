import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapturingMailer, createWorkflowWorld, movableClock, type WorkflowWorld } from "../../testing/index.ts";
import { emailOutbox, notifications } from "../db/schema/notifications.ts";
import { tick } from "../jobs/tick.ts";
import { notify } from "./notify.ts";
import { RETRY_MINUTES } from "./outbox.ts";

const MIN = 60_000;

describe("email outbox", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-10-31T01:00:00.000Z");
  const mailer = createCapturingMailer();
  beforeEach(async () => {
    clock.set("2026-10-31T01:00:00.000Z");
    mailer.sent.length = 0;
    mailer.failing = false;
    w = await createWorkflowWorld({ clock, mailer });
  });
  afterEach(() => w.close());

  const queue = () =>
    notify(w.deps.db, w.deps, {
      orgId: w.org.id,
      recipients: [w.m.staff.membershipId],
      kind: "payslip_released",
      title: "Payslip ready",
      link: "/payroll",
      email: { headline: "Your payslip is ready.", linkPath: "/payroll" },
    });
  const row = async () => (await w.deps.db.select().from(emailOutbox))[0];

  it("retries after 1, 5, 30, 120 and 720 minutes, then marks the email failed and tells owners", async () => {
    expect(RETRY_MINUTES).toEqual([1, 5, 30, 120, 720]);
    await queue();
    mailer.failing = true;
    await tick(w.deps); // first attempt fails
    for (const wait of RETRY_MINUTES) {
      expect((await row())?.status).toBe("queued");
      clock.advance(wait * MIN - 1_000);
      await tick(w.deps);
      expect((await row())?.attempts).toBe(RETRY_MINUTES.indexOf(wait) + 1); // not yet
      clock.advance(1_000);
      await tick(w.deps);
    }
    expect(await row()).toMatchObject({
      status: "failed",
      attempts: 6,
      lastError: expect.stringMatching(/ECONNREFUSED/),
    });
    const owners = await w.deps.db.select().from(notifications).where(eq(notifications.kind, "email_delivery_failed"));
    expect(owners.map((n) => n.recipientMembershipId)).toEqual([w.m.owner.membershipId]);
    expect(mailer.sent).toEqual([]);
  });

  it("SMTP outage of 3 hours: retried on schedule and sent once the server recovers", async () => {
    await queue();
    mailer.failing = true;
    const start = clock.now().getTime();
    while (clock.now().getTime() - start < 3 * 60 * MIN) {
      await tick(w.deps);
      clock.advance(MIN);
    }
    expect((await row())?.status).toBe("queued");
    mailer.failing = false;
    for (let i = 0; i < 12 * 60 && (await row())?.status !== "sent"; i += 10) {
      clock.advance(10 * MIN);
      await tick(w.deps);
    }
    expect(await row()).toMatchObject({ status: "sent" });
    expect(mailer.sent).toHaveLength(1);
  });

  it("queued emails are suppressed when the mailer is removed", async () => {
    await queue();
    const withoutMailer = { ...w.deps, mailer: undefined };
    const report = await tick(withoutMailer);
    expect(report.emails.suppressed).toBe(1);
    expect((await row())?.status).toBe("suppressed");
  });

  it("two concurrent sweeps send an email once", async () => {
    await queue();
    await Promise.all([tick(w.deps), tick(w.deps)]);
    expect(mailer.sent).toHaveLength(1);
  });

  it("a sender that crashed mid-send is picked up again after the lease", async () => {
    await queue();
    await w.deps.db
      .update(emailOutbox)
      .set({ status: "sending", lockedUntil: new Date(clock.now().getTime() + 10 * MIN) });
    await tick(w.deps);
    expect(mailer.sent).toHaveLength(0);
    clock.advance(11 * MIN);
    await tick(w.deps);
    expect(mailer.sent).toHaveLength(1);
  });
});
