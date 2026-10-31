import type { AppDeps } from "../deps.ts";
import type { Actor } from "../employees/access.ts";
import { applyEvent, ctxFor, hire } from "../employees/lifecycle.ts";
import { type NricPrefix, nricCheckLetter } from "../employees/nric.ts";
import type { PeoplePorts } from "../employees/ports.ts";
import { createAllowanceType, setBankAccount } from "../employees/profile.ts";
import { saveCompanyProfile } from "../organisation/profile.ts";
import { createStructure } from "../organisation/structure.ts";
import { createWorkSchedule } from "../organisation/work-schedules.ts";

/**
 * Seeds a realistic, entirely fictional Singapore SME (a café group) through
 * the real services, so the data obeys every rule the API enforces. Used by
 * tests, local screenshots and the public demo.
 *
 * Coverage: citizens, SPRs (1st/2nd year and later, G/G and F/G), EP, S Pass
 * and Work Permit holders (one pass expired, one expiring), Chinese, Malay,
 * Indian, Eurasian and other races, Muslims (MBMF), an SHG opt-out, ages on
 * the CPF 55/60/65/70 boundaries, a manager tree three levels deep, a
 * resignation in notice, a scheduled transfer and raise, and a former
 * employee. NRIC/FIN numbers are generated with valid check letters from
 * fixed digit sequences; none belongs to a real person as far as we know,
 * and none is published by ICA.
 */

export interface SeededPeople {
  departments: Record<string, string>;
  teams: Record<string, string>;
  locations: Record<string, string>;
  schedules: Record<string, string>;
  allowances: Record<string, string>;
  /** Employee ids by key (see SEED_PEOPLE). */
  employees: Record<string, string>;
}

function fakeId(prefix: NricPrefix, n: number): string {
  // Digits run from 9 000 000 upwards with a large stride: well clear of common example numbers.
  const digits = String(9_000_000 + ((n * 104_729) % 999_999)).padStart(7, "0");
  return `${prefix}${digits}${nricCheckLetter(prefix, digits)}`;
}

/**
 * Fictional emergency contacts, picked by index. Whole names on purpose: deriving a "family name"
 * from a legal name is wrong for surname-first Chinese names and for bin/binte/s/o names.
 */
export const SEED_CONTACT_NAMES = [
  "Lim Siew Hong",
  "Rahman bin Ali",
  "Muthu s/o Krishnan",
  "Tan Boon Keng",
  "Norhayati binte Salleh",
  "Lakshmi d/o Pillai",
  "Ong Mei Fong",
  "Grace Pereira",
] as const;

export function seedContactName(n: number): string {
  return SEED_CONTACT_NAMES[n % SEED_CONTACT_NAMES.length] as string;
}

type Seed = {
  key: string;
  legalName: string;
  preferredName?: string;
  idType: "nric" | "fin";
  prefix: NricPrefix;
  dob: string;
  gender: "female" | "male";
  nationality: string;
  residency: "citizen" | "pr" | "foreigner";
  prStartDate?: string;
  sprCpfOption?: "gg" | "fg";
  race?: string;
  religion?: string;
  shgOptOutOn?: string;
  hireDate: string;
  jobTitle: string;
  department: string;
  team?: string;
  location: string;
  manager?: string;
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  schedule?: string;
  basicCents: number;
  payBasis?: "monthly" | "hourly";
  pass?: { type: string; expiresOn: string; issuedOn: string };
  isWorkman?: boolean;
  /** Manager or executive (never EA Part 4). */
  isManagerOrExecutive?: boolean;
  bank?: string;
};

/** Today in the seed is 31 Oct 2026; ages are chosen around the CPF age milestones. */
export const SEED_PEOPLE: Seed[] = [
  {
    key: "owner",
    legalName: "Lim Kah Hui",
    preferredName: "Kah Hui",
    idType: "nric",
    prefix: "S",
    dob: "1978-03-14",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "chinese",
    religion: "buddhism",
    hireDate: "2019-04-01",
    jobTitle: "Managing Director",
    isManagerOrExecutive: true,
    department: "Management",
    location: "hq",
    employmentType: "full_time",
    basicCents: 1_250_000,
    bank: "DBSSSGSG",
  },
  {
    key: "hr",
    legalName: "Nur Aisyah binte Rahman",
    preferredName: "Aisyah",
    idType: "nric",
    prefix: "S",
    dob: "1988-07-22",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "malay",
    religion: "islam",
    hireDate: "2020-01-06",
    jobTitle: "HR & Payroll Executive",
    department: "Management",
    location: "hq",
    manager: "owner",
    employmentType: "full_time",
    basicCents: 520_000,
    bank: "OCBCSGSG",
  },
  {
    key: "opsmgr",
    legalName: "Rajesh s/o Muthusamy",
    preferredName: "Rajesh",
    idType: "nric",
    prefix: "S",
    dob: "1971-11-12",
    gender: "male",
    nationality: "Singaporean",
    residency: "citizen",
    race: "indian",
    religion: "hinduism",
    hireDate: "2019-06-03",
    jobTitle: "Operations Manager",
    isManagerOrExecutive: true,
    department: "Operations",
    location: "hq",
    manager: "owner",
    employmentType: "full_time",
    basicCents: 780_000,
    bank: "UOVBSGSG",
  },
  {
    key: "fin",
    legalName: "Chloe de Souza",
    idType: "nric",
    prefix: "T",
    dob: "2001-02-28",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "eurasian",
    religion: "christianity",
    hireDate: "2024-08-01",
    jobTitle: "Accounts Assistant",
    department: "Finance",
    location: "hq",
    manager: "owner",
    employmentType: "full_time",
    basicCents: 340_000,
    bank: "DBSSSGSG",
  },
  {
    key: "tp_lead",
    legalName: "Tan Wei Ming",
    preferredName: "Wei Ming",
    idType: "nric",
    prefix: "S",
    dob: "1966-10-05",
    gender: "male",
    nationality: "Singaporean",
    residency: "citizen",
    race: "chinese",
    religion: "taoism",
    hireDate: "2019-04-15",
    jobTitle: "Outlet Supervisor",
    department: "Operations",
    team: "Tanjong Pagar outlet",
    location: "tp",
    manager: "opsmgr",
    employmentType: "full_time",
    basicCents: 420_000,
    isWorkman: true,
    bank: "POSBSGSG",
  },
  {
    key: "jp_lead",
    legalName: "Siti Nurhaliza binte Osman",
    preferredName: "Siti",
    idType: "nric",
    prefix: "S",
    dob: "1984-05-30",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "malay",
    religion: "islam",
    hireDate: "2021-03-01",
    jobTitle: "Outlet Supervisor",
    department: "Operations",
    team: "Jurong Point outlet",
    location: "jp",
    manager: "opsmgr",
    employmentType: "full_time",
    basicCents: 400_000,
    bank: "MBBESGS2",
  },
  {
    key: "barista1",
    legalName: "Goh Jun Jie",
    idType: "nric",
    prefix: "T",
    dob: "2004-09-17",
    gender: "male",
    nationality: "Singaporean",
    residency: "citizen",
    race: "chinese",
    religion: "none",
    hireDate: "2025-11-03",
    jobTitle: "Barista",
    department: "Operations",
    team: "Tanjong Pagar outlet",
    location: "tp",
    manager: "tp_lead",
    employmentType: "full_time",
    schedule: "shift",
    basicCents: 230_000,
    isWorkman: true,
    bank: "DBSSSGSG",
  },
  {
    key: "barista2",
    legalName: "Muhammad Hafiz bin Ismail",
    preferredName: "Hafiz",
    idType: "nric",
    prefix: "T",
    dob: "2002-12-03",
    gender: "male",
    nationality: "Singaporean",
    residency: "citizen",
    race: "malay",
    religion: "islam",
    shgOptOutOn: "2026-02-01",
    hireDate: "2024-02-05",
    jobTitle: "Barista",
    department: "Operations",
    team: "Jurong Point outlet",
    location: "jp",
    manager: "jp_lead",
    employmentType: "full_time",
    schedule: "shift",
    basicCents: 240_000,
    isWorkman: true,
    bank: "POSBSGSG",
  },
  {
    key: "pt1",
    legalName: "Ong Hui Min",
    idType: "nric",
    prefix: "T",
    dob: "2007-06-21",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "chinese",
    religion: "christianity",
    hireDate: "2026-06-01",
    jobTitle: "Part-time Service Crew",
    department: "Operations",
    team: "Tanjong Pagar outlet",
    location: "tp",
    manager: "tp_lead",
    employmentType: "part_time",
    schedule: "shift",
    basicCents: 1_100,
    payBasis: "hourly",
    bank: "OCBCSGSG",
  },
  {
    key: "chef",
    legalName: "Benjamin Lee Jia Hao",
    preferredName: "Ben",
    idType: "nric",
    prefix: "S",
    dob: "1975-01-09",
    gender: "male",
    nationality: "Singaporean",
    residency: "citizen",
    race: "chinese",
    religion: "christianity",
    hireDate: "2019-05-02",
    jobTitle: "Head Chef",
    isManagerOrExecutive: true,
    department: "Operations",
    team: "Central kitchen",
    location: "ck",
    manager: "opsmgr",
    employmentType: "full_time",
    basicCents: 650_000,
    bank: "UOVBSGSG",
  },
  {
    key: "senior70",
    legalName: "Teo Ah Seng",
    idType: "nric",
    prefix: "S",
    dob: "1956-10-31",
    gender: "male",
    nationality: "Singaporean",
    residency: "citizen",
    race: "chinese",
    religion: "buddhism",
    hireDate: "2022-01-03",
    jobTitle: "Kitchen Helper",
    department: "Operations",
    team: "Central kitchen",
    location: "ck",
    manager: "chef",
    employmentType: "part_time",
    schedule: "shift",
    basicCents: 160_000,
    isWorkman: true,
    bank: "POSBSGSG",
  },
  {
    key: "senior65",
    legalName: "Kamala d/o Ramasamy",
    preferredName: "Kamala",
    idType: "nric",
    prefix: "S",
    dob: "1961-12-20",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "indian",
    religion: "hinduism",
    hireDate: "2020-09-01",
    jobTitle: "Cleaner",
    department: "Operations",
    team: "Central kitchen",
    location: "ck",
    manager: "chef",
    employmentType: "part_time",
    schedule: "shift",
    basicCents: 150_000,
    isWorkman: true,
    bank: "DBSSSGSG",
  },
  {
    key: "spr_y1",
    legalName: "Zhang Xiaoling",
    idType: "fin",
    prefix: "G",
    dob: "1993-04-18",
    gender: "female",
    nationality: "Chinese",
    residency: "pr",
    prStartDate: "2026-01-15",
    sprCpfOption: "gg",
    race: "chinese",
    religion: "none",
    hireDate: "2023-03-01",
    jobTitle: "Marketing Executive",
    department: "Marketing",
    location: "hq",
    manager: "owner",
    employmentType: "full_time",
    basicCents: 450_000,
    bank: "OCBCSGSG",
  },
  {
    key: "spr_y2",
    legalName: "Arjun Mehta",
    idType: "fin",
    prefix: "F",
    dob: "1990-08-08",
    gender: "male",
    nationality: "Indian",
    residency: "pr",
    prStartDate: "2025-05-20",
    sprCpfOption: "fg",
    race: "indian",
    religion: "hinduism",
    hireDate: "2022-07-04",
    jobTitle: "IT & Systems Executive",
    department: "Finance",
    location: "hq",
    manager: "owner",
    employmentType: "full_time",
    basicCents: 560_000,
    bank: "SCBLSGSG",
  },
  {
    key: "spr_y3",
    legalName: "Nguyen Thi Lan",
    idType: "fin",
    prefix: "G",
    dob: "1987-02-11",
    gender: "female",
    nationality: "Vietnamese",
    residency: "pr",
    prStartDate: "2019-03-02",
    race: "other",
    religion: "buddhism",
    hireDate: "2021-10-01",
    jobTitle: "Pastry Chef",
    department: "Operations",
    team: "Central kitchen",
    location: "ck",
    manager: "chef",
    employmentType: "full_time",
    basicCents: 380_000,
    bank: "DBSSSGSG",
  },
  {
    key: "ep",
    legalName: "Daniel Okafor",
    idType: "fin",
    prefix: "M",
    dob: "1985-06-02",
    gender: "male",
    nationality: "Nigerian",
    residency: "foreigner",
    race: "other",
    religion: "christianity",
    hireDate: "2024-05-06",
    jobTitle: "Head of Growth",
    isManagerOrExecutive: true,
    department: "Marketing",
    location: "hq",
    manager: "owner",
    employmentType: "full_time",
    basicCents: 900_000,
    pass: { type: "EP", issuedOn: "2024-04-20", expiresOn: "2026-12-19" },
    bank: "HSBCSGS2",
  },
  {
    key: "ep_indian",
    legalName: "Priya Ramanathan",
    idType: "fin",
    prefix: "G",
    dob: "1992-10-30",
    gender: "female",
    nationality: "Indian",
    residency: "foreigner",
    race: "indian",
    religion: "hinduism",
    hireDate: "2025-09-01",
    jobTitle: "Finance Manager",
    isManagerOrExecutive: true,
    department: "Finance",
    location: "hq",
    manager: "owner",
    employmentType: "full_time",
    basicCents: 760_000,
    pass: { type: "EP", issuedOn: "2025-08-15", expiresOn: "2027-08-14" },
    bank: "CITISGSL",
  },
  {
    key: "spass",
    legalName: "Maria Santos Reyes",
    preferredName: "Maria",
    idType: "fin",
    prefix: "G",
    dob: "1995-03-25",
    gender: "female",
    nationality: "Filipino",
    residency: "foreigner",
    race: "other",
    religion: "christianity",
    hireDate: "2023-11-01",
    jobTitle: "Senior Barista",
    department: "Operations",
    team: "Jurong Point outlet",
    location: "jp",
    manager: "jp_lead",
    employmentType: "full_time",
    schedule: "shift",
    basicCents: 340_000,
    pass: { type: "S_PASS", issuedOn: "2023-10-10", expiresOn: "2027-10-09" },
    bank: "DBSSSGSG",
  },
  {
    key: "spass_muslim",
    legalName: "Ahmad Faizal bin Abdullah",
    preferredName: "Faizal",
    idType: "fin",
    prefix: "M",
    dob: "1990-01-15",
    gender: "male",
    nationality: "Malaysian",
    residency: "foreigner",
    race: "malay",
    religion: "islam",
    hireDate: "2025-01-06",
    jobTitle: "Line Cook",
    department: "Operations",
    team: "Central kitchen",
    location: "ck",
    manager: "chef",
    employmentType: "full_time",
    schedule: "shift",
    basicCents: 330_000,
    pass: { type: "S_PASS", issuedOn: "2024-12-20", expiresOn: "2027-01-05" },
    isWorkman: true,
    bank: "MBBESGS2",
  },
  {
    key: "wp_expired",
    legalName: "Rahim Uddin",
    idType: "fin",
    prefix: "G",
    dob: "1994-07-07",
    gender: "male",
    nationality: "Bangladeshi",
    residency: "foreigner",
    race: "bangladeshi",
    religion: "islam",
    hireDate: "2024-10-14",
    jobTitle: "Kitchen Assistant",
    department: "Operations",
    team: "Central kitchen",
    location: "ck",
    manager: "chef",
    employmentType: "full_time",
    schedule: "shift",
    basicCents: 180_000,
    pass: { type: "WP", issuedOn: "2024-10-01", expiresOn: "2026-10-20" },
    isWorkman: true,
    bank: "POSBSGSG",
  },
  {
    key: "wp",
    legalName: "Kyaw Zin Htet",
    idType: "fin",
    prefix: "M",
    dob: "1998-12-12",
    gender: "male",
    nationality: "Myanmar",
    residency: "foreigner",
    race: "other",
    religion: "buddhism",
    hireDate: "2025-04-07",
    jobTitle: "Kitchen Assistant",
    department: "Operations",
    team: "Central kitchen",
    location: "ck",
    manager: "chef",
    employmentType: "full_time",
    schedule: "shift",
    basicCents: 175_000,
    pass: { type: "WP", issuedOn: "2025-03-25", expiresOn: "2027-03-24" },
    isWorkman: true,
    bank: "DBSSSGSG",
  },
  {
    key: "leaver",
    legalName: "Koh Pei Shan",
    idType: "nric",
    prefix: "S",
    dob: "1996-04-04",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "chinese",
    religion: "buddhism",
    hireDate: "2022-02-14",
    jobTitle: "Marketing Executive",
    department: "Marketing",
    location: "hq",
    manager: "ep",
    employmentType: "full_time",
    basicCents: 410_000,
    bank: "OCBCSGSG",
  },
  {
    key: "former",
    legalName: "Farhan bin Yusof",
    idType: "nric",
    prefix: "T",
    dob: "2000-08-19",
    gender: "male",
    nationality: "Singaporean",
    residency: "citizen",
    race: "malay",
    religion: "islam",
    hireDate: "2023-01-09",
    jobTitle: "Barista",
    department: "Operations",
    team: "Tanjong Pagar outlet",
    location: "tp",
    manager: "tp_lead",
    employmentType: "full_time",
    schedule: "shift",
    basicCents: 230_000,
    bank: "POSBSGSG",
  },
  {
    key: "intern",
    legalName: "Isabelle Fernandez",
    idType: "nric",
    prefix: "T",
    dob: "2005-01-30",
    gender: "female",
    nationality: "Singaporean",
    residency: "citizen",
    race: "eurasian",
    religion: "christianity",
    hireDate: "2026-11-16",
    jobTitle: "Marketing Intern",
    department: "Marketing",
    location: "hq",
    manager: "spr_y1",
    employmentType: "intern",
    basicCents: 120_000,
    bank: "DBSSSGSG",
  },
];

export async function seedPeople(deps: AppDeps, ports: PeoplePorts, owner: Actor): Promise<SeededPeople> {
  await saveCompanyProfile(deps, ports, owner, {
    legalName: "Kopi Kaki Pte. Ltd.",
    tradingName: "Kopi Kaki",
    uen: "201912345K",
    csn: "201912345KPTE01",
    addressBlock: "10",
    addressStreet: "Anson Road",
    addressUnit: "#12-04",
    addressBuilding: "International Plaza",
    postalCode: "079903",
  });
  const out: SeededPeople = { departments: {}, teams: {}, locations: {}, schedules: {}, allowances: {}, employees: {} };
  for (const name of ["Management", "Operations", "Finance", "Marketing"]) {
    out.departments[name] = (await createStructure(deps, ports, owner, "departments", { name })).id;
  }
  for (const [key, name, address, postalCode] of [
    ["hq", "Anson Road office", "10 Anson Road, #12-04", "079903"],
    ["tp", "Tanjong Pagar outlet", "7 Wallich Street, #01-11", "078884"],
    ["jp", "Jurong Point outlet", "1 Jurong West Central 2, #B1-50", "648886"],
    ["ck", "Central kitchen", "21 Senoko Loop, #03-02", "758171"],
  ] as const) {
    out.locations[key] = (await createStructure(deps, ports, owner, "locations", { name, address, postalCode })).id;
  }
  for (const [name, dept] of [
    ["Tanjong Pagar outlet", "Operations"],
    ["Jurong Point outlet", "Operations"],
    ["Central kitchen", "Operations"],
  ] as const) {
    out.teams[name] = (
      await createStructure(deps, ports, owner, "teams", { name, departmentId: out.departments[dept] })
    ).id;
  }
  await createStructure(deps, ports, owner, "cost-centres", { code: "CC-100", name: "Head office" });
  await createStructure(deps, ports, owner, "cost-centres", { code: "CC-200", name: "Outlets" });
  const working = { type: "working" as const, minutes: 540 };
  out.schedules.office = (
    await createWorkSchedule(deps, ports, owner, {
      name: "Office 5-day",
      kind: "fixed",
      isDefault: true,
      days: [
        working,
        working,
        working,
        working,
        { type: "working", minutes: 480 },
        { type: "off", minutes: 0 },
        { type: "rest", minutes: 0 },
      ],
    })
  ).id;
  out.schedules.shift = (
    await createWorkSchedule(deps, ports, owner, {
      name: "Outlet shifts (44 h)",
      kind: "shift",
      weeklyMinutes: 44 * 60,
    })
  ).id;
  out.allowances.transport = (
    await createAllowanceType(deps, ports, owner, { code: "TRANSPORT", name: "Transport allowance" })
  ).id;
  out.allowances.shift = (await createAllowanceType(deps, ports, owner, { code: "SHIFT", name: "Shift allowance" })).id;

  const ctx = ctxFor(deps, ports, owner);
  let n = 0;
  for (const p of SEED_PEOPLE) {
    n++;
    const { employeeId } = await hire(ctx, {
      person: {
        employeeNumber: `E${String(n).padStart(4, "0")}`,
        legalName: p.legalName,
        preferredName: p.preferredName ?? null,
        idType: p.idType,
        idNumber: fakeId(p.prefix, n),
        dob: p.dob,
        gender: p.gender,
        nationality: p.nationality,
        residencyStatus: p.residency,
        prStartDate: p.prStartDate ?? null,
        sprCpfOption: p.sprCpfOption ?? null,
        race: p.race ?? null,
        religion: p.religion ?? null,
        shgOptOutOn: p.shgOptOutOn ?? null,
        workEmail: `${p.legalName.split(" ")[0]?.toLowerCase()}.${n}@kopikaki.example`,
        mobile: `9${String(1_000_000 + n * 7_331).slice(0, 7)}`,
        address: {
          block: String(100 + n),
          street: "Toa Payoh Lorong 1",
          unit: `#0${(n % 9) + 1}-${10 + n}`,
          postalCode: "310100",
        },
      },
      job: {
        hireDate: p.hireDate,
        jobTitle: p.jobTitle,
        departmentId: out.departments[p.department] as string,
        teamId: p.team ? (out.teams[p.team] as string) : null,
        locationId: out.locations[p.location] as string,
        managerEmployeeId: p.manager ? (out.employees[p.manager] ?? null) : null,
        employmentType: p.employmentType,
        workScheduleId: out.schedules[p.schedule ?? "office"] as string,
        isWorkman: p.isWorkman ?? false,
        isManagerOrExecutive: p.isManagerOrExecutive ?? false,
      },
      compensation: { payBasis: p.payBasis ?? "monthly", amountCents: p.basicCents },
      allowances:
        p.schedule === "shift" && p.payBasis !== "hourly"
          ? [{ allowanceTypeId: out.allowances.shift as string, amountCents: 15_000 }]
          : [],
      workPass: p.pass
        ? {
            passType: p.pass.type,
            passNumber: fakeId(p.prefix, n),
            issuedOn: p.pass.issuedOn,
            expiresOn: p.pass.expiresOn,
          }
        : null,
      emergencyContacts: [
        {
          name: seedContactName(n),
          relationship: "Spouse",
          phone: `8${String(2_000_000 + n * 4_441).slice(0, 7)}`,
        },
      ],
      invite: false,
    });
    out.employees[p.key] = employeeId;
    if (p.bank) {
      await setBankAccount(deps, ports, owner, employeeId, {
        bankCode: p.bank,
        accountNumber: String(1_000_000_000 + n * 97_531),
        holderName: p.legalName,
        effectiveFrom: p.hireDate,
      });
    }
  }
  const e = out.employees as Record<string, string>;
  // A resignation in notice, a former employee, a scheduled transfer and a scheduled raise.
  await applyEvent(ctx, e.leaver as string, { type: "resignation", noticeGivenOn: "2026-10-19", noticeDays: 30 });
  await applyEvent(ctx, e.former as string, {
    type: "termination",
    reason: "contract_end",
    lastWorkingDay: "2026-06-30",
  });
  await applyEvent(ctx, e.barista1 as string, {
    type: "transfer",
    effectiveDate: "2026-12-01",
    changes: { teamId: out.teams["Jurong Point outlet"], locationId: out.locations.jp, managerEmployeeId: e.jp_lead },
  });
  await applyEvent(ctx, e.fin as string, {
    type: "salary_change",
    effectiveDate: "2027-01-01",
    compensation: { payBasis: "monthly", amountCents: 360_000, reason: "Annual increment" },
  });
  await applyEvent(ctx, e.spr_y1 as string, {
    type: "promotion",
    effectiveDate: "2026-07-01",
    changes: { jobTitle: "Senior Marketing Executive" },
    compensation: { payBasis: "monthly", amountCents: 480_000, reason: "Promotion" },
  });
  return out;
}
