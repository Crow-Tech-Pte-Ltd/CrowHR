import { createApp } from "../src/app.ts";
import * as leave from "../src/db/schema/leave.ts";
import { users } from "../src/db/schema/users.ts";
import { ctxFor, hire } from "../src/employees/lifecycle.ts";
import { defaultPeoplePorts } from "../src/employees/ports.ts";
import { createReportingScopeResolver } from "../src/employees/reports/reporting-scope.ts";
import { ensureLeaveSetup } from "../src/leave/defaults.ts";
import { createWorkSchedule } from "../src/organisation/work-schedules.ts";
import { createPeopleHarness, hirePayload, OWNER, seedBasicStructure } from "../src/testing/people-harness.ts";
import { type SeededMember, seedMember } from "./fixtures.ts";
import { clientAs, movableClock, type TestClient } from "./http.ts";
import { createTestDb, createTestDeps, type TestDb } from "./index.ts";

/**
 * Leave and attendance test world (WS5): a Mon–Fri office (Saturday off, Sunday rest) with real
 * people records, reporting lines and memberships, on the real app and workflows engine.
 *
 * | Key | Who | Notes |
 * | --- | --- | --- |
 * | owner | Nur Aisyah | owner, no employee record |
 * | hr | Tan Mei Ling | hr_admin, employee since 2022 |
 * | payroll | Lim Jia Hui | payroll_admin, no employee record |
 * | manager | Wong Kai Wen | employee since 2021, manages staff, newbie, partTimer |
 * | staff | Ravi Kumar | employee since 2 Jan 2024 (service year 3), S$2,400 (Part 4) |
 * | newbie | Siti Rahmah | hired 14 Jul 2026 (first-year pro-rating) |
 * | partTimer | Daniel Goh | part-time, 4 h a day Mon–Fri (20 h a week) |
 * | satRest | Ahmad Ismail | works Sun–Fri, rest day Saturday |
 * | other | Farah Hassan | another team, no line to the manager |
 */
export interface LeaveWorld {
  t: TestDb;
  deps: ReturnType<typeof createTestDeps>;
  app: ReturnType<typeof createApp>;
  clock: ReturnType<typeof movableClock>;
  orgId: string;
  scheduleId: string;
  emp: Record<"hr" | "manager" | "staff" | "newbie" | "partTimer" | "satRest" | "other", string>;
  m: Record<
    "owner" | "hr" | "payroll" | "manager" | "staff" | "newbie" | "partTimer" | "satRest" | "other",
    SeededMember
  >;
  as(key: keyof LeaveWorld["m"]): Promise<TestClient>;
  close(): Promise<void>;
}

export const LEAVE_WORLD_NOW = "2026-10-31T01:00:00.000Z";

export async function createLeaveWorld(opts: { now?: string } = {}): Promise<LeaveWorld> {
  const t = await createTestDb();
  const clock = movableClock(opts.now ?? LEAVE_WORLD_NOW);
  const deps = createTestDeps(t.db, { clock, reportingScope: createReportingScopeResolver(t.db) });
  const h = await createPeopleHarness(deps, { orgName: "Kampong Kopi Pte. Ltd." });
  delete (h.deps as { people?: unknown }).people;
  const structure = await seedBasicStructure(h);
  const ports = defaultPeoplePorts(deps);
  const owner = h.actor(OWNER);
  const partTime = await createWorkSchedule(deps, ports, owner, {
    name: "Part-time mornings",
    kind: "fixed",
    days: [
      { type: "working", minutes: 240 },
      { type: "working", minutes: 240 },
      { type: "working", minutes: 240 },
      { type: "working", minutes: 240 },
      { type: "working", minutes: 240 },
      { type: "off", minutes: 0 },
      { type: "rest", minutes: 0 },
    ],
  });
  const satRest = await createWorkSchedule(deps, ports, owner, {
    name: "Outlet Sun–Fri",
    kind: "fixed",
    days: [
      { type: "working", minutes: 480 },
      { type: "working", minutes: 480 },
      { type: "working", minutes: 480 },
      { type: "working", minutes: 480 },
      { type: "working", minutes: 480 },
      { type: "rest", minutes: 0 },
      { type: "working", minutes: 480 },
    ],
  });
  const hireOne = async (
    name: string,
    job: Record<string, unknown>,
    person: Record<string, unknown> = {},
    compensation: Record<string, unknown> | null = { payBasis: "monthly", amountCents: 400_000 },
  ) =>
    (
      await hire(
        ctxFor(deps, ports, owner),
        hirePayload(structure, { person: { legalName: name, ...person }, job, compensation }),
      )
    ).employeeId;
  const hr = await hireOne("Tan Mei Ling", { hireDate: "2022-03-01", jobTitle: "HR Manager" }, { gender: "female" });
  const manager = await hireOne(
    "Wong Kai Wen",
    { hireDate: "2021-06-01", jobTitle: "Outlet Manager" },
    { gender: "male" },
  );
  const staff = await hireOne(
    "Ravi Kumar",
    { hireDate: "2024-01-02", jobTitle: "Barista", managerEmployeeId: manager },
    { gender: "male" },
    { payBasis: "monthly", amountCents: 240_000 },
  );
  const newbie = await hireOne(
    "Siti Rahmah",
    { hireDate: "2026-07-14", jobTitle: "Barista", managerEmployeeId: manager },
    { gender: "female" },
  );
  const partTimer = await hireOne(
    "Daniel Goh",
    {
      hireDate: "2025-01-06",
      jobTitle: "Part-time Barista",
      managerEmployeeId: manager,
      employmentType: "part_time",
      workScheduleId: partTime.id,
    },
    { gender: "male" },
    { payBasis: "hourly", amountCents: 1_200 },
  );
  const satRestEmp = await hireOne(
    "Ahmad Ismail",
    {
      hireDate: "2023-05-02",
      jobTitle: "Kitchen Crew",
      managerEmployeeId: manager,
      workScheduleId: satRest.id,
      isWorkman: true,
    },
    { gender: "male" },
    { payBasis: "monthly", amountCents: 220_000 },
  );
  const other = await hireOne(
    "Farah Hassan",
    { hireDate: "2023-02-01", jobTitle: "Accounts Executive" },
    { gender: "female" },
  );
  const emp = { hr, manager, staff, newbie, partTimer, satRest: satRestEmp, other };
  const seed = (name: string, roles: ("owner" | "hr_admin" | "payroll_admin")[], employeeId: string | null) =>
    seedMember(deps, h.orgId, {
      displayName: name,
      roles,
      employeeId,
      email: `${name.split(" ")[0]?.toLowerCase()}@kopi.example`,
    });
  const m = {
    owner: await seed("Nur Aisyah", ["owner"], null),
    hr: await seed("Tan Mei Ling", ["hr_admin"], hr),
    payroll: await seed("Lim Jia Hui", ["payroll_admin"], null),
    manager: await seed("Wong Kai Wen", [], manager),
    staff: await seed("Ravi Kumar", [], staff),
    newbie: await seed("Siti Rahmah", [], newbie),
    partTimer: await seed("Daniel Goh", [], partTimer),
    satRest: await seed("Ahmad Ismail", [], satRestEmp),
    other: await seed("Farah Hassan", [], other),
  };
  // Admins have enrolled MFA, so tests may move the clock past the 7-day enrolment grace.
  await deps.db.update(users).set({ mfaEnrolledAt: clock.now() });
  const app = createApp(deps);
  return {
    t,
    deps,
    app,
    clock,
    orgId: h.orgId,
    scheduleId: structure.scheduleId,
    emp,
    m,
    as: (key) => clientAs(app, deps, m[key]),
    close: () => t.close(),
  };
}

/**
 * One row in every leave table for `orgId` (cross-organisation sweep): types (via setup), an
 * extra holiday, a child, a pending request with its day, an attachment and a ledger adjustment.
 */
export async function seedLeaveOnePerTable(
  deps: ReturnType<typeof createTestDeps>,
  orgId: string,
  employeeId: string,
  membershipId: string,
): Promise<void> {
  await ensureLeaveSetup(deps, orgId);
  const [annual] = (await deps.db.select().from(leave.leaveTypes)).filter(
    (t) => t.orgId === orgId && t.code === "annual",
  );
  if (!annual) throw new Error("seedLeaveOnePerTable: no annual leave type");
  await deps.db
    .insert(leave.leaveHolidays)
    .values({ id: deps.ids.newId(), orgId, date: "2026-12-24", name: "Sweep Eve" });
  await deps.db.insert(leave.leaveChildren).values({
    id: deps.ids.newId(),
    orgId,
    employeeId,
    name: "Sweep Baby",
    birthDate: "2026-06-01",
    isCitizen: true,
    birthOrder: 1,
  });
  const requestId = deps.ids.newId();
  await deps.db.insert(leave.leaveRequests).values({
    id: requestId,
    orgId,
    employeeId,
    leaveTypeId: annual.id,
    startDate: "2026-12-01",
    endDate: "2026-12-01",
    startSession: "full",
    endSession: "full",
    unit: "days",
    hundredths: 100,
    status: "pending",
    requestedByMembershipId: membershipId,
  });
  await deps.db.insert(leave.leaveRequestDays).values({
    id: deps.ids.newId(),
    orgId,
    requestId,
    employeeId,
    leaveTypeId: annual.id,
    date: "2026-12-01",
    session: "full",
    hundredths: 100,
    leaveYear: 2026,
  });
  const fileKey = ["org", orgId, "leave", requestId, "sweep.pdf"].join("/");
  await deps.fileStore.put(fileKey, new TextEncoder().encode("%PDF-1.4"), { contentType: "application/pdf" });
  await deps.db.insert(leave.leaveAttachments).values({
    id: deps.ids.newId(),
    orgId,
    requestId,
    fileKey,
    filename: "sweep.pdf",
    contentType: "application/pdf",
    sizeBytes: 8,
    uploadedByMembershipId: membershipId,
  });
  await deps.db.insert(leave.leaveLedger).values({
    id: deps.ids.newId(),
    orgId,
    employeeId,
    leaveTypeId: annual.id,
    leaveYear: 2026,
    kind: "adjustment",
    unit: "days",
    hundredths: 100,
    reason: "Sweep",
  });
}
