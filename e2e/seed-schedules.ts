/**
 * Scheduling (WS5b) e2e data, on top of the leave seed without changing it:
 * - an outlet roster work schedule (`shift`, 44 h a week) and four shift templates;
 * - Nurul Huda and Marcus Lim, rostered crew at HQ reporting to Kai Wen (the e2e flow builds
 *   their roster for next week);
 * - the Bugis outlet with 25 rostered crew and this week's published roster, built by HR, for the
 *   design review of the grid at 25 people × 7 days (with a few honest warnings).
 */
import type { Grant } from "../packages/core/src/access/authorize.ts";
import { systemAuditContext } from "../packages/core/src/audit/audit.ts";
import type { AppDeps } from "../packages/core/src/deps.ts";
import type { Actor as PeopleActor } from "../packages/core/src/employees/access.ts";
import { ctxFor, hire } from "../packages/core/src/employees/lifecycle.ts";
import type { PeoplePorts } from "../packages/core/src/employees/ports.ts";
import { orgScope, schema } from "../packages/core/src/index.ts";
import { createStructure } from "../packages/core/src/organisation/structure.ts";
import { createWorkSchedule } from "../packages/core/src/organisation/work-schedules.ts";
import { publishRoster } from "../packages/core/src/scheduling/publish.ts";
import { createShift, ensureRoster } from "../packages/core/src/scheduling/rosters.ts";
import { createTemplate } from "../packages/core/src/scheduling/templates.ts";
import { hirePayload, type seedBasicStructure } from "../packages/core/src/testing/people-harness.ts";
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

/** Fictional Bugis crew (25). */
const BUGIS = [
  "Aaron Tan",
  "Bala Subramaniam",
  "Cheryl Ng",
  "Dinesh Pillai",
  "Elaine Koh",
  "Fadhil Rahman",
  "Grace Lee",
  "Hafiz Osman",
  "Irene Goh",
  "Jason Teo",
  "Kavitha Raj",
  "Leon Chua",
  "Mei Fen Ong",
  "Nabil Yusof",
  "Olivia Sim",
  "Prakash Menon",
  "Qistina Aziz",
  "Ryan Low",
  "Shalini Das",
  "Terence Yeo",
  "Umairah Salleh",
  "Vincent Ho",
  "Wani Ismail",
  "Xavier Lim",
  "Yvonne Chan",
];

export async function seedSchedules(orgId: string, p: SeededPeople) {
  const deps = p.deps;
  const db = deps.db;
  const hr = p.member(E2E.members.hr.email);
  const actor = {
    orgId,
    membershipId: hr.membershipId,
    employeeId: null,
    audit: {
      ...systemAuditContext(orgId, "system", "e2e seed"),
      actorType: "member" as const,
      actorMembershipId: hr.membershipId,
    },
  };
  // Owners and HR see every roster: the services only read `grant.all` for them.
  const all = { all: true } as unknown as Grant;
  const roster = await createWorkSchedule(deps, p.ports, p.owner, {
    name: "Outlet roster",
    kind: "shift",
    weeklyMinutes: 44 * 60,
  });
  const bugis = await createStructure(deps, p.ports, p.owner, "locations", { name: "Bugis outlet" });
  const tpl = async (
    name: string,
    code: string,
    startTime: string,
    endTime: string,
    breakMinutes: number,
    colour: "plain" | "kuning" | "biru" | "oren" | "ink",
  ) => createTemplate(deps, actor, { name, code, startTime, endTime, breakMinutes, colour, locationId: null });
  const OPN = await tpl("Opening", "OPN", "06:30", "14:30", 30, "oren");
  const AM = await tpl("Morning", "AM", "07:00", "15:00", 30, "kuning");
  const MID = await tpl("Middle", "MID", "11:00", "19:00", 60, "plain");
  const PM = await tpl("Closing", "PM", "15:00", "23:00", 30, "biru");

  const hireOne = async (name: string, job: Record<string, unknown>) =>
    (
      await hire(
        ctxFor(deps, p.ports, p.owner),
        hirePayload(p.structure, {
          person: { legalName: name },
          job: { hireDate: addDays(todaySg(), -400), jobTitle: "Barista", workScheduleId: roster.id, ...job },
          compensation: { payBasis: "monthly", amountCents: 220_000 },
        }),
      )
    ).employeeId;
  const link = (email: string, employeeId: string) =>
    db
      .update(schema.memberships)
      .set({ employeeId })
      .where(orgScope(db, orgId).whereId(schema.memberships, p.member(email).membershipId));
  const nurul = await hireOne(E2E.members.crewA.name, { managerEmployeeId: p.kaiWen });
  const marcus = await hireOne(E2E.members.crewB.name, { managerEmployeeId: p.kaiWen });
  await link(E2E.members.crewA.email, nurul);
  await link(E2E.members.crewB.email, marcus);

  const crew: string[] = [];
  for (const name of BUGIS) crew.push(await hireOne(name, { locationId: bugis.id }));

  // This week at Bugis: a rotating pattern, two rest days each, a few open shifts.
  const week = mondayOf(todaySg());
  const r = await ensureRoster(deps, actor, all, { weekStart: week, locationId: bugis.id, departmentId: null });
  const pattern = [OPN, AM, MID, PM];
  for (const [i, employeeId] of crew.entries()) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(week, d);
      const off = (i + d) % 7;
      // Leon Chua is rostered all seven days (the grid flags "No rest day").
      const everyDay = BUGIS[i] === "Leon Chua";
      if (off === 0 && !everyDay) {
        await createShift(deps, actor, all, r.id, { employeeId, date, kind: "rest", templateId: null, note: null });
        continue;
      }
      if (off === 1 && !everyDay) continue;
      const t = pattern[(i + Math.floor(d / 2)) % pattern.length] as string;
      // Ryan Low does a 13-hour double on Wednesday (the grid flags the 12-hour limit).
      if (BUGIS[i] === "Ryan Low" && d === 2) {
        await createShift(deps, actor, all, r.id, {
          employeeId,
          date,
          kind: "shift",
          templateId: null,
          startTime: "08:00",
          endTime: "22:00",
          breakMinutes: 60,
          note: "Covering the stocktake",
        });
        continue;
      }
      await createShift(deps, actor, all, r.id, { employeeId, date, kind: "shift", templateId: t, note: null });
    }
  }
  for (const d of [4, 5]) {
    await createShift(deps, actor, all, r.id, {
      employeeId: null,
      date: addDays(week, d),
      kind: "shift",
      templateId: PM,
      note: null,
    });
  }
  await publishRoster(deps, actor, all, r.id, { acknowledge: [] });
}
