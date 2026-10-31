/**
 * Leave (WS5) e2e data, added on top of the approvals seed without changing it: Nadia Rahman
 * (hired two years ago) and Tan Wei Ming (three years, a new baby) report to Wong Kai Wen.
 * Approved leave around this week fills the team calendar: Nadia's sick day (with an MC) and
 * annual leave next week, Wei Ming's paternity leave, and a pending half day.
 */
import { createDiskFileStore } from "../apps/server/src/disk-file-store.ts";
import { systemAuditContext } from "../packages/core/src/audit/audit.ts";
import type { AppDeps } from "../packages/core/src/deps.ts";
import type { Actor as PeopleActor } from "../packages/core/src/employees/access.ts";
import { ctxFor, hire } from "../packages/core/src/employees/lifecycle.ts";
import type { PeoplePorts } from "../packages/core/src/employees/ports.ts";
import { orgScope, schema } from "../packages/core/src/index.ts";
import { applyLeave } from "../packages/core/src/leave/apply.ts";
import { ensureLeaveSetup } from "../packages/core/src/leave/defaults.ts";
import { hirePayload, type seedBasicStructure } from "../packages/core/src/testing/people-harness.ts";
import { decideTask } from "../packages/core/src/workflows/engine.ts";
import { E2E } from "./fixtures.ts";

interface SeededPeople {
  structure: Awaited<ReturnType<typeof seedBasicStructure>>;
  kaiWen: string;
  owner: PeopleActor;
  member: (email: string) => { userId: string; membershipId: string };
  deps: AppDeps;
  ports: PeoplePorts;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todaySg = () => iso(new Date(Date.now() + 8 * 3_600_000));
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
/** First Monday–Friday on or after `date`. */
const weekday = (date: string) => {
  let d = date;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
};

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n").toString("base64");

export async function seedLeave(orgId: string, p: SeededPeople) {
  const deps: AppDeps = {
    ...p.deps,
    fileStore: createDiskFileStore(process.env.FILE_STORAGE_DIR ?? "./test-results/files"),
  };
  const db = deps.db;
  const hireOne = async (name: string, years: number, gender: "female" | "male") =>
    (
      await hire(
        ctxFor(deps, p.ports, p.owner),
        hirePayload(p.structure, {
          person: { legalName: name, gender },
          job: {
            hireDate: addDays(todaySg(), -365 * years - 3),
            jobTitle: "Senior Barista",
            managerEmployeeId: p.kaiWen,
          },
        }),
      )
    ).employeeId;
  const nadia = await hireOne(E2E.members.leaveStaff.name, 2, "female");
  const weiMing = await hireOne(E2E.members.leaveDad.name, 3, "male");
  const link = (email: string, employeeId: string) =>
    db
      .update(schema.memberships)
      .set({ employeeId })
      .where(orgScope(db, orgId).whereId(schema.memberships, p.member(email).membershipId));
  await link(E2E.members.leaveStaff.email, nadia);
  await link(E2E.members.leaveDad.email, weiMing);

  await ensureLeaveSetup(deps, orgId);
  const types = (await db.select().from(schema.leaveTypes)).filter((t) => t.orgId === orgId);
  const typeId = (code: string) => {
    const t = types.find((x) => x.code === code);
    if (!t) throw new Error(`seed: no leave type ${code}`);
    return t.id;
  };
  const babyBorn = addDays(todaySg(), -10);
  const childId = deps.ids.newId();
  await db.insert(schema.leaveChildren).values({
    id: childId,
    orgId,
    employeeId: weiMing,
    name: "Tan Yu Xuan",
    birthDate: babyBorn,
    isCitizen: true,
    birthOrder: 1,
    marriedToMother: true,
  });

  const kaiWenMember = p.member(E2E.members.approver.email);
  const actorFor = (email: string, employeeId: string) => {
    const m = p.member(email);
    return {
      orgId,
      membershipId: m.membershipId,
      employeeId,
      roles: [] as const,
      audit: {
        ...systemAuditContext(orgId, "system", "e2e seed"),
        actorType: "member" as const,
        actorMembershipId: m.membershipId,
      },
    };
  };
  const approve = async (approvalRequestId: string) => {
    const task = (await db.select().from(schema.approvalTasks)).find(
      (t) => t.requestId === approvalRequestId && t.status === "pending",
    );
    if (!task) throw new Error("seed: no approval task");
    await decideTask(
      deps,
      {
        orgId,
        membershipId: kaiWenMember.membershipId,
        roles: [],
        audit: {
          ...systemAuditContext(orgId, "system", "e2e seed"),
          actorType: "member",
          actorMembershipId: kaiWenMember.membershipId,
        },
      },
      { taskId: task.id, decision: "approve" },
    );
  };
  const apply = async (
    who: "leaveStaff" | "leaveDad",
    employeeId: string,
    input: Parameters<typeof applyLeave>[3],
    approved = true,
  ) => {
    const r = await applyLeave(deps, actorFor(E2E.members[who].email, employeeId), employeeId, input);
    const row = await orgScope(db, orgId).findById(schema.leaveRequests, r.id);
    if (approved && row?.approvalRequestId) await approve(row.approvalRequestId);
  };
  const mon = mondayOf(todaySg());
  const sickDay = weekday(addDays(mon, 1));
  await apply("leaveStaff", nadia, {
    leaveTypeId: typeId("sick_outpatient"),
    startDate: sickDay,
    endDate: sickDay,
    startSession: "full",
    endSession: "full",
    reason: "Fever",
    attachments: [{ filename: "mc-raffles-medical.pdf", contentType: "application/pdf", dataBase64: PDF }],
  });
  await apply("leaveStaff", nadia, {
    leaveTypeId: typeId("annual"),
    startDate: addDays(mon, 9),
    endDate: addDays(mon, 11),
    startSession: "full",
    endSession: "full",
    reason: "Family trip to Penang",
  });
  await apply("leaveDad", weiMing, {
    leaveTypeId: typeId("paternity"),
    startDate: babyBorn,
    endDate: addDays(babyBorn, 27),
    startSession: "full",
    endSession: "full",
    childId,
    reason: "Baby Yu Xuan",
  });
  // Pending: Wei Ming's half day after his paternity leave.
  const halfDay = weekday(addDays(babyBorn, 31));
  await apply(
    "leaveDad",
    weiMing,
    {
      leaveTypeId: typeId("annual"),
      startDate: halfDay,
      endDate: halfDay,
      startSession: "am",
      endSession: "am",
      reason: "Baby's check-up",
    },
    false,
  );

  // Attendance: punches on the last six weekdays before today (Kai Wen on time, Ahmad late once,
  // Farah with a missing clock-out and an evening of overtime, Nadia except her sick day).
  const memberships = (await db.select().from(schema.memberships)).filter((m) => m.orgId === orgId);
  const employeeOf = (email: string) =>
    memberships.find((m) => m.id === p.member(email).membershipId)?.employeeId ?? null;
  const today = todaySg();
  const days: string[] = [];
  for (let d = addDays(today, -1); days.length < 6; d = addDays(d, -1)) {
    if (![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) days.unshift(d);
  }
  const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`);
  const punch = async (employeeId: string, date: string, kind: "in" | "out", hhmm: string) => {
    const t = at(date, hhmm);
    await db.insert(schema.attendancePunches).values({
      id: deps.ids.newId(),
      orgId,
      employeeId,
      kind,
      idempotencyKey: `seed-${employeeId}-${date}-${kind}`,
      source: "web",
      deviceTime: t,
      sentAt: t,
      serverTime: new Date(t.getTime() + 1_500),
      recordedAt: t,
      workDate: date,
      skewSeconds: 1,
    });
  };
  const plan: [string | null, (date: string, i: number) => [string, string | null] | null][] = [
    [employeeOf(E2E.members.approver.email), (_d, i) => [`08:5${i}`, `18:0${i}`]],
    [employeeOf(E2E.members.requester.email), (_d, i) => [i === 3 ? "09:17" : "08:57", "18:02"]],
    [employeeOf(E2E.members.shots.email), (_d, i) => [`08:4${i}`, i === 4 ? null : i === 2 ? "20:15" : "18:05"]],
    [nadia, (d) => (d === sickDay ? null : ["08:55", "18:01"])],
  ];
  for (const [employeeId, times] of plan) {
    if (!employeeId) continue;
    for (const [i, d] of days.entries()) {
      const t = times(d, i);
      if (!t) continue;
      await punch(employeeId, d, "in", t[0]);
      if (t[1]) await punch(employeeId, d, "out", t[1]);
    }
  }
}
