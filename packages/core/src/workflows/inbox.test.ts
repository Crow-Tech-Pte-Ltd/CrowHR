import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createFakeSubjects,
  createPeopleDatesDouble,
  createWorkflowWorld,
  EMP,
  movableClock,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { createStaticReportingScope } from "../access/scope.ts";
import { sortInbox } from "./inbox.ts";
import type { InboxItem, InboxSource } from "./types.ts";

const DAY = 86_400_000;

function item(over: Partial<InboxItem>): InboxItem {
  return {
    id: over.id ?? "x",
    source: "test",
    kind: "test",
    title: over.id ?? "x",
    concerns: null,
    detail: null,
    dueOn: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    href: "/",
    actionLabel: "Open",
    task: null,
    ...over,
  };
}

describe("Home inbox", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-10-31T01:00:00.000Z");
  const people = createPeopleDatesDouble();
  const checklist: InboxSource = {
    id: "checklists",
    label: "Checklists",
    status: async () => "ready",
    async list(_db, ctx) {
      if (ctx.membershipId !== w.m.manager.membershipId) return [];
      return [
        item({
          id: "checklist:1",
          source: "checklists",
          kind: "checklist",
          title: "Prepare a laptop for Siti",
          dueOn: "2026-11-04",
        }),
      ];
    },
  };
  beforeEach(async () => {
    clock.set("2026-10-31T01:00:00.000Z");
    w = await createWorkflowWorld({
      clock,
      peopleDates: people,
      reportingScope: createStaticReportingScope({ [EMP.manager]: [EMP.staff, EMP.other], [EMP.head]: [EMP.manager] }),
      workflowPlugins: [createFakeSubjects().plugin, { name: "checklists", inbox: [checklist] }],
    });
  });
  afterEach(() => w.close());

  it("sorts overdue first, then due date, then undated by age", () => {
    const today = "2026-10-31";
    const sorted = sortInbox(
      [
        item({ id: "undated-new", createdAt: "2026-10-30T00:00:00.000Z" }),
        item({ id: "due-later", dueOn: "2026-11-05" }),
        item({ id: "overdue-1", dueOn: "2026-10-30" }),
        item({ id: "undated-old", createdAt: "2026-10-01T00:00:00.000Z" }),
        item({ id: "overdue-3", dueOn: "2026-10-28" }),
        item({ id: "due-today", dueOn: "2026-10-31" }),
      ],
      today,
    );
    expect(sorted.map((i) => i.id)).toEqual([
      "overdue-3",
      "overdue-1",
      "due-today",
      "due-later",
      "undated-old",
      "undated-new",
    ]);
  });

  it("manager's Home: overdue leave task, then the checklist item due tomorrow, then the other leave task", async () => {
    // Leave 1 submitted 28 Oct → due 31 Oct 09:00 + … make it overdue: submitted 4 days ago.
    clock.set("2026-10-27T01:00:00.000Z");
    await w.submit(w.m.staff, "leave");
    clock.set("2026-11-01T01:00:00.000Z");
    await w.submit(w.m.other, "leave"); // due 4 Nov
    clock.set("2026-11-03T01:00:00.000Z"); // first one is overdue, checklist due tomorrow (4 Nov)
    const client = await clientAs(w.app, w.deps, w.m.manager);
    const res = await client.get("/api/v1/inbox");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        title: string;
        concerns: string | null;
        dueOn: string | null;
        overdueDays: number;
        task: { inline: boolean } | null;
      }[];
    };
    expect(body.items.map((i) => [i.concerns ?? i.title, i.dueOn, i.overdueDays])).toEqual([
      ["Ravi Kumar", "2026-10-30", 4],
      ["Prepare a laptop for Siti", "2026-11-04", 0],
      ["Siti Rahmah", "2026-11-04", 0],
    ]);
    expect(body.items[0]?.task?.inline).toBe(true);
  });

  it("shows only items the member may act on, by role", async () => {
    people.passes.push({
      orgId: w.org.id,
      passId: "00000000-0000-7000-8000-00000000dd01",
      employeeId: EMP.other,
      employeeName: "Siti Rahmah",
      passType: "Work Permit",
      expiresOn: "2026-11-18",
    });
    people.probations.push({
      orgId: w.org.id,
      employeeId: EMP.staff,
      employeeName: "Ravi Kumar",
      endsOn: "2026-11-03",
    });
    const get = async (m: (typeof w.m)[keyof typeof w.m]) =>
      (
        (await (await (await clientAs(w.app, w.deps, m)).get("/api/v1/inbox")).json()) as { items: { kind: string }[] }
      ).items
        .map((i) => i.kind)
        // Setup steps (this test org has no company profile or employees) are covered elsewhere.
        .filter((k) => k !== "setup");
    expect((await get(w.m.hr)).sort()).toEqual(["probation_end", "work_pass_expiry"]);
    expect(await get(w.m.manager)).toEqual(["probation_end", "checklist"]);
    expect(await get(w.m.head)).toEqual([]); // not Ravi's direct manager
    expect(await get(w.m.staff)).toEqual([]);
    people.passes.length = 0;
    people.probations.length = 0;
  });

  it("an employee with nothing to do gets an empty list; missing sources say not_set_up", async () => {
    const plain = await createWorkflowWorld({ clock });
    try {
      const client = await clientAs(plain.app, plain.deps, plain.m.staff);
      const body = (await (await client.get("/api/v1/inbox")).json()) as {
        items: unknown[];
        sources: { id: string; status: string }[];
      };
      expect(body.items).toEqual([]);
      expect(body.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "approvals", status: "ready" }),
          expect.objectContaining({ id: "work_passes", status: "not_set_up" }),
          expect.objectContaining({ id: "probation", status: "not_set_up" }),
        ]),
      );
    } finally {
      await plain.close();
    }
  });

  it("answers within a second with 40 open tasks", async () => {
    for (let i = 0; i < 40; i++) await w.submit(w.m.staff, "claim", { amountCents: 100 + i });
    clock.advance(DAY);
    const client = await clientAs(w.app, w.deps, w.m.manager);
    const started = performance.now();
    const res = await client.get("/api/v1/inbox");
    expect(res.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
