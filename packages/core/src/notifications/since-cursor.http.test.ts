import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createWorkflowWorld,
  movableClock,
  type TestClient,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { notify } from "./notify.ts";

/**
 * `GET /api/v1/notifications?since=<cursor>` (add-mobile-apps task 1.2): the mobile apps' background
 * refresh asks only for notifications newer than the last ones they saw. Every list response carries
 * an opaque `cursor`; passing it back as `since` returns only newer items, oldest first, and the
 * cursor does not move when nothing is new or when items are read.
 */

type Page = { items: { id: string; title: string; readAt: string | null }[]; cursor: string | null; total: number };

describe("notifications since cursor", () => {
  let w: WorkflowWorld;
  let staff: TestClient;
  const clock = movableClock("2026-11-02T01:00:00.000Z");

  const send = async (title: string, to = w.m.staff.membershipId) =>
    notify(w.deps.db, w.deps, { orgId: w.org.id, recipients: [to], kind: "request_approved", title, link: "/inbox" });
  const list = async (query = "", client = staff): Promise<Page> => {
    const res = await client.get(`/api/v1/notifications${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as Page;
  };

  beforeEach(async () => {
    clock.set("2026-11-02T01:00:00.000Z");
    w = await createWorkflowWorld({ clock });
    staff = await clientAs(w.app, w.deps, w.m.staff);
    for (const title of ["First", "Second", "Third"]) {
      await send(title);
      clock.advance(60_000);
    }
    await send("For the manager", w.m.manager.membershipId);
  });
  afterEach(() => w.close());

  it("returns a cursor for the newest item, and nothing newer than it", async () => {
    const first = await list();
    expect(first.items.map((n) => n.title)).toEqual(["Third", "Second", "First"]);
    expect(first.cursor).toEqual(expect.any(String));
    // Opaque: it doesn't expose the notification ID or a readable timestamp.
    expect(first.cursor).not.toContain(first.items[0]?.id ?? "-");
    expect(first.cursor).not.toMatch(/2026/);
    const none = await list(`?since=${first.cursor}`);
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
    expect(none.cursor).toBe(first.cursor);
  });

  it("returns only newer items, oldest first, and moves the cursor to the last one returned", async () => {
    const { cursor } = await list();
    clock.advance(60_000);
    await send("Fourth");
    await send("Fifth"); // same millisecond as Fourth
    const newer = await list(`?since=${cursor}`);
    expect(newer.items.map((n) => n.title).sort()).toEqual(["Fifth", "Fourth"]);
    expect(newer.total).toBe(2);
    expect(newer.cursor).not.toBe(cursor);
    expect((await list(`?since=${newer.cursor}`)).items).toEqual([]);
  });

  it("pages through newer items with the cursor, including items created in the same millisecond", async () => {
    const { cursor } = await list();
    clock.advance(60_000);
    for (const t of ["A", "B", "C"]) await send(t);
    const seen: string[] = [];
    let since = cursor;
    for (let i = 0; i < 5; i++) {
      const page = await list(`?since=${since}&pageSize=1`);
      if (!page.items.length) break;
      seen.push(...page.items.map((n) => n.title));
      since = page.cursor;
    }
    expect(seen.sort()).toEqual(["A", "B", "C"]);
  });

  it("is stable: repeating the call or reading items does not move it", async () => {
    const a = await list();
    const b = await list();
    expect(b.cursor).toBe(a.cursor);
    await staff.post("/api/v1/notifications/read-all");
    expect((await list()).cursor).toBe(a.cursor);
    expect((await list("?page=2&pageSize=1")).cursor).toBe(a.cursor);
  });

  it("combines with the unread filter and never shows another member's items", async () => {
    const { cursor } = await list();
    clock.advance(60_000);
    await send("Unread one");
    await send("Not mine", w.m.manager.membershipId);
    const page = await list(`?since=${cursor}&unread=true`);
    expect(page.items.map((n) => n.title)).toEqual(["Unread one"]);
    const manager = await clientAs(w.app, w.deps, w.m.manager);
    expect((await list(`?since=${cursor}`, manager)).items.map((n) => n.title)).not.toContain("Unread one");
  });

  it("refuses a cursor it did not issue, saying how to fix it", async () => {
    for (const bad of ["nonsense", "dGVzdA", "%00"]) {
      const res = await staff.get(`/api/v1/notifications?since=${bad}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string; details?: unknown } };
      expect(JSON.stringify(body.error)).toMatch(/cursor/i);
    }
  });

  it("with no notifications yet the cursor is null", async () => {
    const other = await clientAs(w.app, w.deps, w.m.hr);
    const empty = await list("", other);
    expect(empty.items).toEqual([]);
    expect(empty.cursor).toBeNull();
  });
});
