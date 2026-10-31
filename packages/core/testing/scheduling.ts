import { and, asc, eq } from "drizzle-orm";
import { tenures } from "../src/db/schema/employees.ts";
import { notifications } from "../src/db/schema/notifications.ts";
import { departments, locations } from "../src/db/schema/organisation.ts";
import {
  publishedShifts,
  rosterPublications,
  rosterShifts,
  rosters,
  shiftSwaps,
  shiftTemplates,
} from "../src/db/schema/scheduling.ts";
import { users } from "../src/db/schema/users.ts";
import { buildActor } from "../src/employees/access.ts";
import { ctxFor, hire } from "../src/employees/lifecycle.ts";
import { defaultPeoplePorts } from "../src/employees/ports.ts";
import { createStructure } from "../src/organisation/structure.ts";
import { createWorkSchedule } from "../src/organisation/work-schedules.ts";
import { hirePayload } from "../src/testing/people-harness.ts";
import { type SeededMember, seedMember } from "./fixtures.ts";
import { clientAs, type TestClient } from "./http.ts";
import type { createTestDeps } from "./index.ts";
import { createLeaveWorld, type LeaveWorld } from "./leave.ts";

/**
 * Scheduling test world (WS5b), on top of the leave world (Kampong Kopi, Tanjong Pagar HQ, Wong
 * Kai Wen managing Ravi, Siti, Daniel and Ahmad). Adds an outlet roster work schedule (`shift`,
 * 44 h a week) and three rostered café crew reporting to Kai Wen, plus a second outlet:
 *
 * | Key | Who | Notes |
 * | --- | --- | --- |
 * | crewA | Lee Wei Ming | rostered, S$2,200 a month, at HQ |
 * | crewB | Nurul Huda | rostered, S$2,000 a month, at HQ |
 * | crewC | Chen Jun | rostered, at HQ, leaves on 13 Nov 2026 |
 * | bugis | Priya Nair | rostered, at the Bugis outlet (another location) |
 *
 * The clock starts on Sat 31 Oct 2026; "next week" is Mon 2 Nov 2026.
 */
export interface SchedulingWorld extends LeaveWorld {
  locationId: string;
  bugisId: string;
  departmentId: string;
  rosterScheduleId: string;
  crew: Record<"crewA" | "crewB" | "crewC" | "bugis", string>;
  cm: Record<"crewA" | "crewB" | "crewC" | "bugis", SeededMember>;
  asCrew(key: "crewA" | "crewB" | "crewC" | "bugis"): Promise<TestClient>;
}

export const NEXT_MONDAY = "2026-11-02";

export async function createSchedulingWorld(opts: { now?: string } = {}): Promise<SchedulingWorld> {
  const w = await createLeaveWorld(opts);
  const deps = w.deps;
  const ports = defaultPeoplePorts(deps);
  const owner = buildActor({
    db: deps.db,
    orgId: w.orgId,
    userId: w.m.owner.userId,
    requestId: null,
    roles: ["owner"],
    employeeId: null,
    today: "2026-10-31",
  });
  const [loc] = await deps.db.select().from(locations).orderBy(asc(locations.createdAt));
  const depts = await deps.db.select().from(departments).orderBy(asc(departments.createdAt));
  if (!loc || !depts[0]) throw new Error("scheduling world: no structure");
  const bugis = await createStructure(deps, ports, owner, "locations", { name: "Bugis outlet" });
  const roster = await createWorkSchedule(deps, ports, owner, {
    name: "Outlet roster",
    kind: "shift",
    weeklyMinutes: 44 * 60,
  });
  const structure = {
    departments: { sales: depts[0].id, ops: depts[1]?.id ?? depts[0].id, finance: depts[2]?.id ?? depts[0].id },
    scheduleId: roster.id,
    locationId: loc.id,
  };
  const hireCrew = async (name: string, amountCents: number, job: Record<string, unknown> = {}) =>
    (
      await hire(
        ctxFor(deps, ports, owner),
        hirePayload(structure, {
          person: { legalName: name },
          job: {
            hireDate: "2025-03-03",
            jobTitle: "Barista",
            workScheduleId: roster.id,
            managerEmployeeId: w.emp.manager,
            ...job,
          },
          compensation: { payBasis: "monthly", amountCents },
        }),
      )
    ).employeeId;
  const crew = {
    crewA: await hireCrew("Lee Wei Ming", 220_000),
    crewB: await hireCrew("Nurul Huda", 200_000),
    crewC: await hireCrew("Chen Jun", 200_000),
    bugis: await hireCrew("Priya Nair", 200_000, { locationId: bugis.id }),
  };
  // Chen Jun has resigned: last working day Fri 13 Nov 2026.
  await deps.db
    .update(tenures)
    .set({ lastWorkingDay: "2026-11-13" })
    .where(and(eq(tenures.orgId, w.orgId), eq(tenures.employeeId, crew.crewC)));
  const seed = (name: string, employeeId: string) =>
    seedMember(deps, w.orgId, {
      displayName: name,
      roles: [],
      employeeId,
      email: `${name.split(" ")[0]?.toLowerCase()}@kopi.example`,
    });
  const cm = {
    crewA: await seed("Lee Wei Ming", crew.crewA),
    crewB: await seed("Nurul Huda", crew.crewB),
    crewC: await seed("Chen Jun", crew.crewC),
    bugis: await seed("Priya Nair", crew.bugis),
  };
  await deps.db.update(users).set({ mfaEnrolledAt: w.clock.now() });
  return {
    ...w,
    locationId: loc.id,
    bugisId: bugis.id,
    departmentId: depts[0].id,
    rosterScheduleId: roster.id,
    crew,
    cm,
    asCrew: (key) => clientAs(w.app, deps, cm[key]),
  };
}

/** JSON body of a response, asserting its status. */
export async function ok<T = Record<string, unknown>>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await res;
  const body = r.status === 204 ? null : await r.json();
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(body)}`);
  return body as T;
}

/** One row in every scheduling table for `orgId` (cross-organisation sweep). */
export async function seedSchedulingOnePerTable(
  deps: ReturnType<typeof createTestDeps>,
  orgId: string,
  employeeId: string,
  membershipId: string,
): Promise<void> {
  const [loc] = (await deps.db.select().from(locations)).filter((l) => l.orgId === orgId);
  let locationId = loc?.id;
  if (!locationId) {
    locationId = deps.ids.newId();
    await deps.db.insert(locations).values({ id: locationId, orgId, name: "Sweep outlet" });
  }
  const templateId = deps.ids.newId();
  await deps.db.insert(shiftTemplates).values({
    id: templateId,
    orgId,
    name: "Sweep",
    code: "SW",
    startTime: "09:00",
    endTime: "17:00",
    breakMinutes: 60,
  });
  const rosterId = deps.ids.newId();
  await deps.db.insert(rosters).values({
    id: rosterId,
    orgId,
    locationId,
    scopeKey: `${locationId}:*`,
    weekStart: "2026-11-02",
    status: "published",
    version: 1,
  });
  const shift = {
    orgId,
    rosterId,
    employeeId,
    kind: "shift" as const,
    date: "2026-11-03",
    startsAt: new Date("2026-11-03T01:00:00Z"),
    endsAt: new Date("2026-11-03T09:00:00Z"),
    breakMinutes: 60,
    templateId,
  };
  const shiftId = deps.ids.newId();
  await deps.db.insert(rosterShifts).values({ id: shiftId, ...shift });
  await deps.db
    .insert(publishedShifts)
    .values({ id: shiftId, ...shift, version: 1, publishedAt: new Date("2026-10-30T01:00:00Z") });
  await deps.db.insert(rosterPublications).values({
    id: deps.ids.newId(),
    orgId,
    rosterId,
    version: 1,
    publishedByMembershipId: membershipId,
    publishedAt: new Date("2026-10-30T01:00:00Z"),
  });
  await deps.db.insert(shiftSwaps).values({
    id: deps.ids.newId(),
    orgId,
    rosterId,
    kind: "pickup",
    shiftId,
    requesterEmployeeId: employeeId,
    status: "cancelled",
    createdByMembershipId: membershipId,
    expiresAt: new Date("2026-11-03T01:00:00Z"),
  });
}

/** Applies for leave as `client` (type by code); returns the request id. */
export async function applyLeaveAs(
  client: TestClient,
  code: string,
  startDate: string,
  endDate = startDate,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const types = await ok<{ items: { id: string; code: string }[] }>(client.get("/api/v1/leave/types"));
  const type = types.items.find((t) => t.code === code);
  if (!type) throw new Error(`no leave type ${code}`);
  return (
    await ok<{ id: string }>(
      client.post("/api/v1/leave/requests", { leaveTypeId: type.id, startDate, endDate, ...extra }),
      201,
    )
  ).id;
}

/** Decides every open task of `subjectType` assigned to `client`; returns the responses' statuses. */
export async function decideAll(
  client: TestClient,
  subjectType: string,
  decision: "approve" | "reject" = "approve",
): Promise<{ status: number; body: unknown }[]> {
  const tasks = await ok<{ items: { taskId: string; subjectType: string }[] }>(client.get("/api/v1/approvals/tasks"));
  const out: { status: number; body: unknown }[] = [];
  for (const t of tasks.items.filter((x) => x.subjectType === subjectType)) {
    const r = await client.post(`/api/v1/approvals/tasks/${t.taskId}/decision`, { decision });
    out.push({ status: r.status, body: await r.json() });
  }
  return out;
}

/** Notification titles a member received, oldest first. */
export async function notificationTitles(
  deps: ReturnType<typeof createTestDeps>,
  membershipId: string,
): Promise<string[]> {
  const rows = await deps.db
    .select({ title: notifications.title, createdAt: notifications.createdAt })
    .from(notifications)
    .where(eq(notifications.recipientMembershipId, membershipId))
    .orderBy(asc(notifications.createdAt), asc(notifications.id));
  return rows.map((r) => r.title);
}
