import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "./index.ts";

describe("workflows schema", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
  });
  afterAll(() => t.close());

  it("creates the workflow and notification tables", async () => {
    const { rows } = await t.pglite.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "approval_policies",
        "approval_policy_steps",
        "approval_requests",
        "approval_steps",
        "approval_tasks",
        "approval_comments",
        "delegations",
        "notifications",
        "notification_prefs",
        "email_outbox",
        "reminders_sent",
      ]),
    );
  });

  it("rejects a task that points at another organisation's request (composite FK)", async () => {
    const a = await seedOrg(deps);
    const b = await seedOrg(deps);
    const ma = await seedMember(deps, a.id);
    const mb = await seedMember(deps, b.id);
    const requestId = deps.ids.newId();
    await t.pglite.query(
      `insert into approval_requests (id, org_id, subject_type, subject_id, requester_membership_id, policy_name, status, title, submitted_at)
       values ($1, $2, 'leave', $3, $4, 'Default', 'pending', 'x', now())`,
      [requestId, b.id, deps.ids.newId(), mb.membershipId],
    );
    await expect(
      t.pglite.query(
        `insert into approval_tasks (id, org_id, request_id, position, assignee_membership_id, origin, status, created_at)
         values ($1, $2, $3, 1, $4, 'resolved', 'pending', now())`,
        [deps.ids.newId(), a.id, requestId, ma.membershipId],
      ),
    ).rejects.toThrow(/approval_tasks_request_fk/);
    // A request whose requester belongs to another organisation is rejected too.
    await expect(
      t.pglite.query(
        `insert into approval_requests (id, org_id, subject_type, subject_id, requester_membership_id, policy_name, status, title, submitted_at)
         values ($1, $2, 'leave', $3, $4, 'Default', 'pending', 'x', now())`,
        [deps.ids.newId(), a.id, deps.ids.newId(), mb.membershipId],
      ),
    ).rejects.toThrow(/approval_requests_requester_fk/);
  });

  it("allows one open request per subject", async () => {
    const org = await seedOrg(deps);
    const m = await seedMember(deps, org.id);
    const subject = deps.ids.newId();
    const insert = (status: string) =>
      t.pglite.query(
        `insert into approval_requests (id, org_id, subject_type, subject_id, requester_membership_id, policy_name, status, title, submitted_at)
         values ($1, $2, 'claim', $3, $4, 'Default', $5, 'x', now())`,
        [deps.ids.newId(), org.id, subject, m.membershipId, status],
      );
    await insert("rejected");
    await insert("pending");
    await expect(insert("pending")).rejects.toThrow(/approval_requests_open_subject_unique/);
  });

  it("de-duplicates reminders per source, subject and threshold", async () => {
    const org = await seedOrg(deps);
    const insert = () =>
      t.pglite.query(
        "insert into reminders_sent (org_id, source, subject_key, threshold, sent_at) values ($1, 'work_pass_expiry', 'p1', 'd30', now())",
        [org.id],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/reminders_sent_unique/);
  });
});
