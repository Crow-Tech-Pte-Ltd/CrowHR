import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowWorld, type WorkflowWorld } from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { approvalSteps } from "../db/schema/workflows.ts";
import { builtInDefaultSteps, conditionMatches, replacePolicies, resolvePolicy } from "./policies.ts";

describe("policy resolution", () => {
  let w: WorkflowWorld;
  beforeEach(async () => {
    w = await createWorkflowWorld();
  });
  afterEach(() => w.close());

  const audit = () => systemAuditContext(w.org.id, "system", "test");
  const claimPolicies = () =>
    replacePolicies(w.deps.db, w.deps, audit(), w.org.id, "claim", [
      { name: "Default", condition: null, priority: 0, steps: [{ approverRule: "manager", escalateAfterDays: 3 }] },
      {
        name: "Over S$500",
        condition: { amountGte: 50_000 },
        priority: 10,
        steps: [
          { approverRule: "manager", escalateAfterDays: 3 },
          { approverRule: "role:owner", escalateAfterDays: 3 },
        ],
      },
      {
        name: "Over S$2,000",
        condition: { amountGte: 200_000 },
        priority: 20,
        steps: [{ approverRule: "role:owner", escalateAfterDays: 0 }],
      },
      {
        name: "Medical",
        condition: { typeCodes: ["medical"] },
        priority: 5,
        steps: [{ approverRule: "role:hr_admin", escalateAfterDays: 3 }],
      },
    ]);

  it("built-in defaults: payroll → owner, profile change bank → payroll_admin, others manager then hr_admin", () => {
    expect(builtInDefaultSteps("payroll_run", {}).map((s) => s.approverRule)).toEqual(["role:owner"]);
    expect(builtInDefaultSteps("profile_change", { typeCode: "bank" }).map((s) => s.approverRule)).toEqual([
      "role:payroll_admin",
    ]);
    expect(builtInDefaultSteps("profile_change", { typeCode: "address" }).map((s) => s.approverRule)).toEqual([
      "role:hr_admin",
    ]);
    expect(builtInDefaultSteps("leave", {}).map((s) => s.approverRule)).toEqual(["manager", "role:hr_admin"]);
    expect(builtInDefaultSteps("leave", {}).every((s) => s.escalateAfterDays === 3)).toBe(true);
  });

  it("matches amount and type-code conditions", () => {
    expect(conditionMatches({ amountGte: 50_000 }, { amountCents: 50_000 })).toBe(true);
    expect(conditionMatches({ amountGte: 50_000 }, { amountCents: 49_999 })).toBe(false);
    expect(conditionMatches({ amountGte: 50_000 }, {})).toBe(false);
    expect(conditionMatches({ typeCodes: ["medical"] }, { typeCode: "medical" })).toBe(true);
    expect(conditionMatches({ typeCodes: ["medical"] }, { typeCode: "transport" })).toBe(false);
    expect(conditionMatches(null, {})).toBe(true);
  });

  it("picks the highest-priority matching policy, else the stored default", async () => {
    await claimPolicies();
    const pick = async (attrs: object) => (await resolvePolicy(w.deps.db, w.org.id, "claim", attrs)).name;
    expect(await pick({ amountCents: 62_000 })).toBe("Over S$500");
    expect(await pick({ amountCents: 250_000 })).toBe("Over S$2,000");
    expect(await pick({ amountCents: 1_000, typeCode: "medical" })).toBe("Medical");
    expect(await pick({ amountCents: 1_000 })).toBe("Default");
    // Another type with nothing stored falls back to the built-in default.
    const leave = await resolvePolicy(w.deps.db, w.org.id, "leave", {});
    expect(leave).toMatchObject({ policyId: null, name: "Default" });
  });

  it("amount threshold adds a step: a S$620.00 claim gets manager then owner", async () => {
    await claimPolicies();
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 62_000 });
    const steps = await w.deps.db.select().from(approvalSteps).where(eq(approvalSteps.requestId, requestId));
    expect(steps.sort((a, b) => a.position - b.position).map((s) => s.approverRule)).toEqual(["manager", "role:owner"]);
  });

  it("a policy edit does not change a request already submitted", async () => {
    await claimPolicies();
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 62_000 });
    await replacePolicies(w.deps.db, w.deps, audit(), w.org.id, "claim", [
      {
        name: "Default",
        condition: null,
        priority: 0,
        steps: [
          { approverRule: "manager", escalateAfterDays: 3 },
          { approverRule: "role:hr_admin", escalateAfterDays: 3 },
          { approverRule: "role:owner", escalateAfterDays: 3 },
        ],
      },
    ]);
    const steps = await w.deps.db.select().from(approvalSteps).where(eq(approvalSteps.requestId, requestId));
    expect(steps.map((s) => s.approverRule).sort()).toEqual(["manager", "role:owner"]);
    const next = await w.submit(w.m.staff, "claim", { amountCents: 62_000 });
    const nextSteps = await w.deps.db.select().from(approvalSteps).where(eq(approvalSteps.requestId, next.requestId));
    expect(nextSteps).toHaveLength(3);
  });

  it("payroll runs default to owner", async () => {
    const { requestId } = await w.submit(w.m.payroll, "payroll_run", {});
    const steps = await w.deps.db.select().from(approvalSteps).where(eq(approvalSteps.requestId, requestId));
    expect(steps.map((s) => s.approverRule)).toEqual(["role:owner"]);
  });
});
