import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  movableClock,
  type SeededMember,
  seedMember,
  type TestDb,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { employees, profileChangeRequests } from "../db/schema/employees.ts";
import { notifications } from "../db/schema/notifications.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import { applyEvent, ctxFor, hire } from "../employees/lifecycle.ts";
import { defaultPeoplePorts } from "../employees/ports.ts";
import { createReportingScopeResolver } from "../employees/reports/reporting-scope.ts";
import { addWorkPass } from "../employees/work-pass.ts";
import { tick } from "../jobs/tick.ts";
import { createPeopleHarness, HR, hirePayload, OWNER, seedBasicStructure } from "../testing/people-harness.ts";
import { resolveRule } from "./engine.ts";
import { profileValueLabel } from "./people.ts";
import { replacePolicies } from "./policies.ts";

/**
 * Workflows wired to the real people module (no doubles): reporting lines from employment
 * records, work-pass and probation dates, profile change requests decided through the engine,
 * manager re-routing on a transfer, checklist and setup items on Home, and the `former` sweep.
 */
describe("workflows × people", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00.000Z");
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let orgId: string;
  let emp: { boss: string; manager: string; staff: string; other: string };
  let m: {
    owner: SeededMember;
    hr: SeededMember;
    payroll: SeededMember;
    manager: SeededMember;
    staff: SeededMember;
    boss: SeededMember;
  };
  let structure: Awaited<ReturnType<typeof seedBasicStructure>>;
  let harness: Awaited<ReturnType<typeof createPeopleHarness>>;

  beforeEach(async () => {
    clock.set("2026-10-31T01:00:00.000Z");
    t = await createTestDb();
    // As on the server: manager scope from employment records.
    deps = createTestDeps(t.db, { clock, reportingScope: createReportingScopeResolver(t.db) });
    const h = await createPeopleHarness(deps, { orgName: "Kampong Kopi Pte. Ltd." });
    harness = h;
    // The real ports (engine-backed approvals, identity's audit), not the memory doubles.
    delete (h.deps as { people?: unknown }).people;
    orgId = h.orgId;
    structure = await seedBasicStructure(h);
    const ports = defaultPeoplePorts(deps);
    const owner = h.actor(OWNER);
    const hireOne = async (name: string, job: Record<string, unknown> = {}) =>
      (await hire(ctxFor(deps, ports, owner), hirePayload(structure, { person: { legalName: name }, job }))).employeeId;
    const boss = await hireOne("Rajesh Kumar");
    const manager = await hireOne("Wong Kai Wen", { managerEmployeeId: boss });
    const staff = await hireOne("Ravi Kumar", { managerEmployeeId: manager, probationEnd: "2026-11-12" });
    const other = await hireOne("Siti Rahmah", { managerEmployeeId: manager });
    emp = { boss, manager, staff, other };
    const seed = (name: string, roles: ("owner" | "hr_admin" | "payroll_admin")[], employeeId: string | null) =>
      seedMember(deps, orgId, {
        displayName: name,
        roles,
        employeeId,
        email: `${name.split(" ")[0]?.toLowerCase()}@kopi.example`,
      });
    m = {
      owner: await seed("Nur Aisyah", ["owner"], null),
      hr: await seed("Tan Mei Ling", ["hr_admin"], null),
      payroll: await seed("Lim Jia Hui", ["payroll_admin"], null),
      boss: await seed("Rajesh Kumar", [], boss),
      manager: await seed("Wong Kai Wen", [], manager),
      staff: await seed("Ravi Kumar", [], staff),
    };
    app = createApp(deps);
  });
  afterEach(() => t.close());

  const openTasks = (requestId: string) =>
    deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.status, "pending")));

  it("resolves the line manager from employment records", async () => {
    const ctx = { db: deps.db, deps, now: clock.now() };
    const request = {
      id: deps.ids.newId(),
      subjectId: deps.ids.newId(),
      subjectType: "leave",
      attributes: {},
      excludedDeciderMembershipIds: [],
      orgId,
      requesterMembershipId: m.staff.membershipId,
      requesterEmployeeId: emp.staff,
    };
    expect((await resolveRule(ctx, request, "manager")).members.map((x) => x.membershipId)).toEqual([
      m.manager.membershipId,
    ]);
    expect((await resolveRule(ctx, request, "manager_of_manager")).members.map((x) => x.membershipId)).toEqual([
      m.boss.membershipId,
    ]);
  });

  it("a profile change goes through the engine: HR approves in the inbox and the change is applied", async () => {
    const asStaff = await clientAs(app, deps, m.staff);
    const sub = await asStaff.post("/api/v1/people/me/change-requests", {
      personal: { religion: "christianity", race: "eurasian" },
    });
    expect(sub.status).toBe(201);
    const changeId = ((await sub.json()) as { items: { id: string }[] }).items[0]?.id as string;
    const [request] = await deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, changeId));
    expect(request).toMatchObject({
      subjectType: "profile_change",
      title: "Personal details change",
      status: "pending",
    });
    const [row] = await deps.db.select().from(profileChangeRequests).where(eq(profileChangeRequests.id, changeId));
    expect(row?.approvalRequestId).toBe(request?.id);

    const asHr = await clientAs(app, deps, m.hr);
    const inbox = (await (await asHr.get("/api/v1/inbox")).json()) as {
      items: { kind: string; title: string; task: { id: string; inline: boolean } | null }[];
    };
    const item = inbox.items.find((i) => i.kind === "approval");
    expect(item).toMatchObject({ title: "Personal details change", task: { inline: true } });
    const detail = (await (await asHr.get(`/api/v1/approvals/requests/${request?.id}`)).json()) as {
      summary: { lines: { label: string; value: string }[] };
    };
    // The labels people see on the forms, not stored values.
    expect(detail.summary.lines).toEqual([
      { label: "Race", value: "Eurasian" },
      { label: "Religion", value: "Christianity" },
    ]);
    expect(
      [
        ["idType", "fin"],
        ["residencyStatus", "pr"],
        ["religion", "undisclosed"],
        ["raceSecondary", "sikh"],
        ["dob", "1990-04-12"],
        ["bankCode", "OCBCSGSG"],
        ["legalName", "Tan Mei Ling"],
        ["religion", null],
      ].map(([f, v]) => profileValueLabel(f as string, v ?? null)),
    ).toEqual([
      "FIN",
      "Permanent resident",
      "Prefer not to say",
      "Sikh",
      "12 Apr 1990",
      "OCBC Bank",
      "Tan Mei Ling",
      "(cleared)",
    ]);

    const res = await asHr.post(`/api/v1/approvals/tasks/${item?.task?.id}/decision`, { decision: "approve" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { requestStatus: string }).requestStatus).toBe("approved");
    const [updated] = await deps.db.select().from(employees).where(eq(employees.id, emp.staff));
    expect(updated?.religion).toBe("christianity");
    const [decided] = await deps.db.select().from(profileChangeRequests).where(eq(profileChangeRequests.id, changeId));
    expect(decided?.status).toBe("approved");
    const notes = await deps.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.recipientMembershipId, m.staff.membershipId), eq(notifications.kind, "request_approved")),
      );
    expect(notes.map((n) => [n.title, n.link])).toEqual([["Your profile change request was approved", "/me/profile"]]);
  });

  it("bank changes go to payroll admins; rejection keeps the old details", async () => {
    const asStaff = await clientAs(app, deps, m.staff);
    const sub = await asStaff.post("/api/v1/people/me/change-requests", {
      bank: { bankCode: "OCBCSGSG", accountNumber: "5012345678", holderName: "Ravi Kumar" },
    });
    const changeId = ((await sub.json()) as { items: { id: string }[] }).items[0]?.id as string;
    const [request] = await deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, changeId));
    const tasks = await openTasks(request?.id as string);
    expect(tasks.map((x) => x.assigneeMembershipId)).toEqual([m.payroll.membershipId]);
    const asPayroll = await clientAs(app, deps, m.payroll);
    const res = await asPayroll.post(`/api/v1/approvals/tasks/${tasks[0]?.id}/decision`, {
      decision: "reject",
      comment: "The holder name doesn't match your NRIC.",
    });
    expect(res.status).toBe(200);
    const [decided] = await deps.db.select().from(profileChangeRequests).where(eq(profileChangeRequests.id, changeId));
    expect(decided).toMatchObject({ status: "rejected", decisionNote: "The holder name doesn't match your NRIC." });
  });

  it("cancelling in people withdraws the approval; the legacy decision endpoint is gone, the engine decides", async () => {
    const asStaff = await clientAs(app, deps, m.staff);
    const a = (await (
      await asStaff.post("/api/v1/people/me/change-requests", { personal: { religion: "islam" } })
    ).json()) as {
      items: { id: string }[];
    };
    const aId = a.items[0]?.id as string;
    expect((await asStaff.post(`/api/v1/people/me/change-requests/${aId}/cancel`)).status).toBe(204);
    const [ra] = await deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, aId));
    expect(ra?.status).toBe("withdrawn");

    const b = (await (
      await asStaff.post("/api/v1/people/me/change-requests", { personal: { religion: "hinduism" } })
    ).json()) as {
      items: { id: string }[];
    };
    const bId = b.items[0]?.id as string;
    const asHr = await clientAs(app, deps, m.hr);
    // The old people endpoint bypassed the policy chain (review): it no longer exists.
    expect((await asHr.post(`/api/v1/people/change-requests/${bId}/decision`, { decision: "approve" })).status).toBe(
      404,
    );
    const [open] = await deps.db
      .select()
      .from(approvalTasks)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalTasks.requestId))
      .where(and(eq(approvalRequests.subjectId, bId), eq(approvalTasks.status, "pending")));
    expect(
      (await asHr.post(`/api/v1/approvals/tasks/${open?.approval_tasks.id}/decision`, { decision: "approve" })).status,
    ).toBe(200);
    const [rb] = await deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, bId));
    expect(rb?.status).toBe("approved");
    expect(await openTasks(rb?.id as string)).toEqual([]);

    // Withdrawing from the Inbox cancels the change request.
    const c = (await (
      await asStaff.post("/api/v1/people/me/change-requests", { personal: { religion: "taoism" } })
    ).json()) as {
      items: { id: string }[];
    };
    const cId = c.items[0]?.id as string;
    const [rc] = await deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, cId));
    expect((await asStaff.post(`/api/v1/approvals/requests/${rc?.id}/withdraw`)).status).toBe(200);
    const [pc] = await deps.db.select().from(profileChangeRequests).where(eq(profileChangeRequests.id, cId));
    expect(pc?.status).toBe("cancelled");
  });

  it("a transfer to a new manager moves the open manager task", async () => {
    // Personal-detail changes are decided by HR admins (canDecide), so these managers are HR admins too.
    await deps.db.insert(membershipRoles).values([
      { orgId, membershipId: m.manager.membershipId, role: "hr_admin" },
      { orgId, membershipId: m.boss.membershipId, role: "hr_admin" },
    ]);
    await replacePolicies(deps.db, deps, systemAuditContext(orgId, "system", "t"), orgId, "profile_change", [
      { name: "Default", condition: null, priority: 0, steps: [{ approverRule: "manager", escalateAfterDays: 3 }] },
    ]);
    const asStaff = await clientAs(app, deps, m.staff);
    const sub = (await (
      await asStaff.post("/api/v1/people/me/change-requests", { personal: { religion: "sikhism" } })
    ).json()) as {
      items: { id: string }[];
    };
    const [request] = await deps.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.subjectId, sub.items[0]?.id as string));
    expect((await openTasks(request?.id as string)).map((x) => x.assigneeMembershipId)).toEqual([
      m.manager.membershipId,
    ]);
    const ports = defaultPeoplePorts(deps);
    await applyEvent(ctxFor(deps, ports, harness.actor(OWNER)), emp.staff, {
      type: "transfer",
      effectiveDate: "2026-10-31",
      changes: { managerEmployeeId: emp.boss },
    });
    expect((await openTasks(request?.id as string)).map((x) => x.assigneeMembershipId)).toEqual([m.boss.membershipId]);
  });

  it("Home shows real work passes, probation, onboarding checklist items and setup steps", async () => {
    await deps.db.update(employees).set({ preferredName: "Ravi" }).where(eq(employees.id, emp.staff));
    await deps.db.update(employees).set({ preferredName: "Siti" }).where(eq(employees.id, emp.other));
    const ports = defaultPeoplePorts(deps);
    await addWorkPass(deps, ports, harness.actor(HR), emp.other, {
      passType: "S_PASS",
      passNumber: "G1234567X",
      issuedOn: "2025-01-02",
      expiresOn: "2026-11-25",
    });
    const asHr = await clientAs(app, deps, m.hr);
    const body = (await (await asHr.get("/api/v1/inbox")).json()) as {
      items: { kind: string; title: string; concerns: string | null; dueOn: string | null }[];
      sources: { id: string; status: string }[];
    };
    expect(body.sources.find((s) => s.id === "work_passes")?.status).toBe("ready");
    expect(body.items.find((i) => i.kind === "work_pass_expiry")).toMatchObject({
      concerns: "Siti Rahmah",
      dueOn: "2026-11-25",
    });
    expect(body.items.find((i) => i.kind === "probation_end")).toMatchObject({
      concerns: "Ravi Kumar",
      dueOn: "2026-11-12",
    });
    expect(body.items.some((i) => i.kind === "onboarding")).toBe(true);
    expect(body.items.filter((i) => i.kind === "setup").map((i) => i.title)).toEqual(["Company profile"]);

    // The manager sees the probation of their own report, and their reports' manager checklist items.
    const asManager = await clientAs(app, deps, m.manager);
    const mine = (await (await asManager.get("/api/v1/inbox")).json()) as { items: { kind: string }[] };
    expect(mine.items.map((i) => i.kind)).toContain("probation_end");
    expect(mine.items.map((i) => i.kind)).not.toContain("setup");

    // Reminders from real data: the 30-day work pass reminder and the 14-day probation one, once.
    const first = await tick(deps);
    expect(first.reminders).toBe(2);
    expect((await tick(deps)).reminders).toBe(0);
  });

  it("Home reads only its own organisation's passes and probations", async () => {
    const ports = defaultPeoplePorts(deps);
    await addWorkPass(deps, ports, harness.actor(HR), emp.other, {
      passType: "S_PASS",
      passNumber: "G1234567X",
      issuedOn: "2025-01-02",
      expiresOn: "2026-11-25",
    });
    const range = { today: "2026-10-31", until: "2027-01-31" };
    const { peopleDates } = await import("./people.ts");
    expect((await peopleDates.workPassesExpiring(deps.db, { ...range, orgId })).length).toBe(1);
    expect(await peopleDates.workPassesExpiring(deps.db, { ...range, orgId: deps.ids.newId() })).toEqual([]);
    expect((await peopleDates.probationsEnding(deps.db, { ...range, orgId })).length).toBeGreaterThan(0);
    expect(await peopleDates.probationsEnding(deps.db, { ...range, orgId: deps.ids.newId() })).toEqual([]);
    // The Home sources ask for the member's organisation only (never every organisation's names).
    const asked: (string | undefined)[] = [];
    const spy = {
      workPassesExpiring: (
        db: Parameters<typeof peopleDates.workPassesExpiring>[0],
        r: { orgId?: string; today: string; until: string },
      ) => {
        asked.push(r.orgId);
        return peopleDates.workPassesExpiring(db, r);
      },
      probationsEnding: (
        db: Parameters<typeof peopleDates.probationsEnding>[0],
        r: { orgId?: string; today: string; until: string },
      ) => {
        asked.push(r.orgId);
        return peopleDates.probationsEnding(db, r);
      },
    };
    const spied = createTestDeps(t.db, { clock, reportingScope: createReportingScopeResolver(t.db), peopleDates: spy });
    const asHr = await clientAs(createApp(spied), spied, m.hr);
    expect((await asHr.get("/api/v1/inbox")).status).toBe(200);
    expect(asked.length).toBe(2);
    expect(asked.every((o) => o === orgId)).toBe(true);
  });

  it("the sweep runs the former-membership transition", async () => {
    const ports = defaultPeoplePorts(deps);
    await applyEvent(ctxFor(deps, ports, harness.actor(OWNER)), emp.other, {
      type: "termination",
      reason: "contract_end",
      lastWorkingDay: "2026-10-31",
    });
    const otherMember = await seedMember(deps, orgId, { employeeId: emp.other, email: "siti@kopi.example" });
    expect((await tick(deps)).transitions.membership_former).toBe(0);
    clock.set("2026-11-01T01:00:00.000Z");
    expect((await tick(deps)).transitions.membership_former).toBe(1);
    const [row] = await deps.db.select().from(memberships).where(eq(memberships.id, otherMember.membershipId));
    expect(row?.status).toBe("former");
  });
});
