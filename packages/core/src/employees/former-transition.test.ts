import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import {
  createPeopleHarness,
  hirePayload,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { runFormerTransitions } from "./former.ts";
import { applyEvent, ctxFor, hire } from "./lifecycle.ts";

let t: TestDb;
let h: PeopleHarness;
beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
});
afterEach(() => t.close());

describe("former membership transition", () => {
  it("runs the day after the last working day, once", async () => {
    const s = await seedBasicStructure(h);
    const ctx = ctxFor(h.deps, h.ports, h.actor(OWNER));
    const { employeeId } = await hire(ctx, hirePayload(s));
    await applyEvent(ctx, employeeId, {
      type: "termination",
      reason: "mutual_agreement",
      lastWorkingDay: "2026-11-30",
    });
    // 30 Nov 2026 23:59 SGT: still employed.
    expect(await runFormerTransitions(h.deps, h.ports.memberships, new Date("2026-11-30T15:59:00Z"))).toBe(0);
    // 1 Dec 2026 00:00 SGT.
    expect(await runFormerTransitions(h.deps, h.ports.memberships, new Date("2026-11-30T16:00:00Z"))).toBe(1);
    expect(h.ports.memberships.formers).toEqual([{ orgId: h.orgId, employeeId, lastWorkingDay: "2026-11-30" }]);
    expect(await runFormerTransitions(h.deps, h.ports.memberships, new Date("2026-12-05T01:00:00Z"))).toBe(0);
  });

  it("skips a tenure followed by a rehire", async () => {
    const s = await seedBasicStructure(h);
    const ctx = ctxFor(h.deps, h.ports, h.actor(OWNER));
    const { employeeId } = await hire(ctx, hirePayload(s, { job: { hireDate: "2024-01-02" } }));
    await applyEvent(ctx, employeeId, { type: "termination", reason: "contract_end", lastWorkingDay: "2025-06-30" });
    await applyEvent(ctx, employeeId, {
      type: "rehire",
      job: {
        hireDate: "2026-03-01",
        jobTitle: "Barista",
        departmentId: s.departments.ops,
        employmentType: "part_time",
      },
    });
    expect(await runFormerTransitions(h.deps, h.ports.memberships)).toBe(0);
  });
});
