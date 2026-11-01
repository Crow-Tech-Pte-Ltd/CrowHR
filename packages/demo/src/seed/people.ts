import type { AppDeps } from "@crowhr/core";
import {
  applyEvent,
  buildActor,
  createStructure,
  ctxFor,
  defaultPeoplePorts,
  hire,
  nricCheckLetter,
  type SeededPeople,
  seedContactName,
  seedPeople,
  setBankAccount,
} from "@crowhr/core/seed";
import { singaporeDate } from "./dates.ts";

/**
 * The demo company: Kopi Kaki Pte. Ltd., a café group with a central kitchen, an office and three
 * outlets. `seedPeople` (core's shared fictional seed, 24 people covering every residency, pass
 * type, race/SHG fund and the CPF 55/60/65/70 age boundaries) plus a third outlet with its
 * supervisor, a joiner who starts this month and a leaver whose last day is this month.
 *
 * Every name, NRIC/FIN, bank account and email is invented. ID numbers carry valid check letters
 * so the real validation accepts them; email domains are `.example` (RFC 2606).
 */
export const DEMO_ORG = { name: "Kopi Kaki Pte. Ltd.", slug: "kopi-kaki" } as const;

/** Extra people on top of core's SEED_PEOPLE (keys must not clash with it). */
const EXTRA = [
  {
    key: "tb_lead",
    legalName: "Lau Mei Xuan",
    preferredName: "Mei Xuan",
    prefix: "S" as const,
    dob: "1990-09-09",
    gender: "female" as const,
    race: "chinese",
    religion: "christianity",
    hireDate: "2024-03-04",
    jobTitle: "Outlet Supervisor",
    manager: "opsmgr",
    basicCents: 410_000,
    bank: "OCBCSGSG",
  },
  {
    key: "joiner",
    legalName: "Darren Chua Wei Liang",
    preferredName: "Darren",
    prefix: "T" as const,
    dob: "1999-05-14",
    gender: "male" as const,
    race: "chinese",
    religion: "none",
    hireDate: "2026-10-12",
    jobTitle: "Barista",
    manager: "tb_lead",
    basicCents: 250_000,
    bank: "DBSSSGSG",
  },
  {
    key: "leaver_oct",
    legalName: "Priyanka d/o Selvam",
    preferredName: "Priyanka",
    prefix: "T" as const,
    dob: "1997-12-01",
    gender: "female" as const,
    race: "indian",
    religion: "hinduism",
    hireDate: "2023-05-02",
    jobTitle: "Barista",
    manager: "tb_lead",
    basicCents: 245_000,
    bank: "UOVBSGSG",
  },
];

function extraId(prefix: "S" | "T", n: number): string {
  // A different digit range from seed-people.ts (8 000 000+), so the two never collide.
  const digits = String(8_000_000 + n * 61_007).padStart(7, "0");
  return `${prefix}${digits}${nricCheckLetter(prefix, digits)}`;
}

export interface DemoPeople extends SeededPeople {
  orgId: string;
}

export async function seedDemoPeople(deps: AppDeps, orgId: string, ownerUserId: string): Promise<DemoPeople> {
  const ports = defaultPeoplePorts(deps);
  const owner = buildActor({
    db: deps.db,
    orgId,
    userId: ownerUserId,
    requestId: null,
    roles: ["owner"],
    employeeId: null,
    today: singaporeDate(deps.clock.now()),
  });
  const people = await seedPeople(deps, ports, owner);

  const location = await createStructure(deps, ports, owner, "locations", {
    name: "Tiong Bahru outlet",
    address: "55 Tiong Bahru Road, #01-39",
    postalCode: "160055",
  });
  const team = await createStructure(deps, ports, owner, "teams", {
    name: "Tiong Bahru outlet",
    departmentId: people.departments.Operations,
  });
  people.locations.tb = location.id;
  people.teams["Tiong Bahru outlet"] = team.id;

  const ctx = ctxFor(deps, ports, owner);
  let n = 0;
  for (const p of EXTRA) {
    n++;
    const { employeeId } = await hire(ctx, {
      person: {
        employeeNumber: `E${String(100 + n).padStart(4, "0")}`,
        legalName: p.legalName,
        preferredName: p.preferredName,
        idType: "nric",
        idNumber: extraId(p.prefix, n),
        dob: p.dob,
        gender: p.gender,
        nationality: "Singaporean",
        residencyStatus: "citizen",
        race: p.race,
        religion: p.religion,
        workEmail: `${p.preferredName.toLowerCase().replace(/\s+/g, "")}.tb@kopikaki.example`,
        mobile: `8${String(3_100_000 + n * 5_119).slice(0, 7)}`,
        address: { block: String(20 + n), street: "Tiong Bahru Road", unit: `#0${n}-0${n}`, postalCode: "160020" },
      },
      job: {
        hireDate: p.hireDate,
        jobTitle: p.jobTitle,
        departmentId: people.departments.Operations as string,
        teamId: team.id,
        locationId: location.id,
        managerEmployeeId: people.employees[p.manager] ?? null,
        employmentType: "full_time",
        workScheduleId: people.schedules.shift as string,
        isWorkman: p.jobTitle === "Barista",
        isManagerOrExecutive: p.jobTitle === "Outlet Supervisor",
      },
      compensation: { payBasis: "monthly", amountCents: p.basicCents },
      allowances: [{ allowanceTypeId: people.allowances.shift as string, amountCents: 15_000 }],
      workPass: null,
      emergencyContacts: [{ name: seedContactName(n + 3), relationship: "Parent", phone: `9${3_200_000 + n * 7}` }],
      invite: false,
    });
    people.employees[p.key] = employeeId;
    await setBankAccount(deps, ports, owner, employeeId, {
      bankCode: p.bank,
      accountNumber: String(2_000_000_000 + n * 86_243),
      holderName: p.legalName,
      effectiveFrom: p.hireDate,
    });
  }
  return { ...people, orgId };
}

/** The October leaver resigns in September (30 days' notice, last day 16 Oct 2026). */
export async function resignLeaver(deps: AppDeps, orgId: string, ownerUserId: string, people: DemoPeople) {
  const ports = defaultPeoplePorts(deps);
  const owner = buildActor({
    db: deps.db,
    orgId,
    userId: ownerUserId,
    requestId: null,
    roles: ["owner"],
    employeeId: null,
    today: singaporeDate(deps.clock.now()),
  });
  await applyEvent(ctxFor(deps, ports, owner), people.employees.leaver_oct as string, {
    type: "resignation",
    noticeGivenOn: "2026-09-16",
    noticeDays: 30,
  });
}

/** Familiar names in everyday use; all records are fictional. Kept demo-local. */
export const PREFERRED_NAMES: Record<string, string> = {
  owner: "Kah Hui",
  hr: "Aisyah",
  opsmgr: "Rajesh",
  fin: "Chloe",
  tp_lead: "Wei Ming",
  jp_lead: "Siti",
  barista1: "Jun Jie",
  barista2: "Hafiz",
  pt1: "Hui Min",
  chef: "Ben",
  senior70: "Ah Seng",
  senior65: "Kamala",
  spr_y1: "Xiaoling",
  spr_y2: "Arjun",
  spr_y3: "Lan",
  ep: "Daniel",
  ep_indian: "Priya",
  spass: "Maria",
  spass_muslim: "Faizal",
  wp_expired: "Rahim",
  wp: "Kyaw",
  leaver: "Pei Shan",
  former: "Farhan",
  intern: "Isabelle",
  tb_lead: "Mei Xuan",
  joiner: "Darren",
  leaver_oct: "Priyanka",
};
