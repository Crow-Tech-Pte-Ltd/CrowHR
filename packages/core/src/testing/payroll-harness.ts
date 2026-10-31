import { ytdOpeningBalances } from "../db/schema/employees.ts";
import type { AppDeps } from "../deps.ts";
import { applyEvent, ctxFor, hire } from "../employees/lifecycle.ts";
import { createAllowanceType, setBankAccount } from "../employees/profile.ts";
import { saveCompanyProfile } from "../organisation/profile.ts";
import {
  type BasicStructure,
  createPeopleHarness,
  hirePayload,
  nextNric,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "./people-harness.ts";

/**
 * A fictional 12-person Singapore company for payroll tests ("Kopi Kaki Pte. Ltd."), built through
 * the real people services. Every CPF age band, SPR year 1 and 2 (G/G), a foreigner on an EP, a
 * mid-month joiner and a leaver in October 2026, a bonus that hits the AW ceiling, no-pay leave,
 * overtime and a deduction over the Employment Act cap are covered by the October fixture items
 * (see payroll/company-month.http.test.ts). Names and NRICs are fictional.
 */

export interface PayrollCompany {
  h: PeopleHarness;
  structure: BasicStructure;
  allowances: { transport: string };
  /** Employee ids by key A–L. */
  e: Record<CompanyKey, string>;
}

export type CompanyKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

export interface Person {
  key: string;
  name: string;
  dob: string;
  residency: "citizen" | "pr" | "foreigner";
  prStartDate?: string;
  race?: string;
  religion?: string;
  hireDate: string;
  basicCents: number;
  pass?: { passType: string; issuedOn: string; expiresOn: string };
  idPrefix?: "S" | "T" | "F" | "G";
}

export const COMPANY_PEOPLE: (Person & { key: CompanyKey })[] = [
  {
    key: "A",
    name: "Aw Chee Keong",
    dob: "1990-04-12",
    residency: "citizen",
    hireDate: "2020-01-06",
    basicCents: 400_000,
  },
  {
    key: "B",
    name: "Bala Krishnan",
    dob: "1968-05-20",
    residency: "citizen",
    hireDate: "2015-03-02",
    basicCents: 350_000,
  },
  {
    key: "C",
    name: "Chua Siew Lan",
    dob: "1963-02-10",
    residency: "citizen",
    hireDate: "2012-07-16",
    basicCents: 300_000,
  },
  {
    key: "D",
    name: "Daud bin Hassan",
    dob: "1959-08-08",
    residency: "citizen",
    hireDate: "2010-09-01",
    basicCents: 240_000,
  },
  {
    key: "E",
    name: "Esther Goh",
    dob: "1950-01-15",
    residency: "citizen",
    hireDate: "2019-05-06",
    basicCents: 180_000,
  },
  {
    key: "F",
    name: "Fang Wei",
    dob: "1992-06-01",
    residency: "pr",
    prStartDate: "2026-02-01",
    hireDate: "2024-04-01",
    basicCents: 500_000,
  },
  {
    key: "G",
    name: "Gao Ming",
    dob: "1988-09-09",
    residency: "pr",
    prStartDate: "2025-03-15",
    hireDate: "2023-08-01",
    basicCents: 450_000,
  },
  {
    key: "H",
    name: "Harish Iyer",
    dob: "1987-11-30",
    residency: "foreigner",
    race: "indian",
    religion: "hinduism",
    hireDate: "2024-05-06",
    basicCents: 900_000,
    pass: { passType: "EP", issuedOn: "2024-04-15", expiresOn: "2027-04-14" },
    idPrefix: "G",
  },
  {
    key: "I",
    name: "Isabel Tan",
    dob: "1999-12-24",
    residency: "citizen",
    hireDate: "2026-10-16",
    basicCents: 360_000,
    idPrefix: "T",
  },
  { key: "J", name: "Jason Lim", dob: "1993-03-03", residency: "citizen", hireDate: "2022-01-03", basicCents: 440_000 },
  {
    key: "K",
    name: "Kavitha Raj",
    dob: "1985-03-03",
    residency: "citizen",
    hireDate: "2018-01-02",
    basicCents: 800_000,
  },
  {
    key: "L",
    name: "Lee Jia Hui",
    dob: "1995-07-07",
    residency: "citizen",
    hireDate: "2021-06-01",
    basicCents: 200_000,
  },
];

export interface SeededCompany<K extends string> {
  h: PeopleHarness;
  structure: BasicStructure;
  allowances: { transport: string };
  e: Record<K, string>;
}

/** An organisation with a complete company profile, a Mon–Fri schedule and the given people hired. */
export async function seedCompany<K extends string>(
  deps: AppDeps,
  people: (Omit<Person, "key"> & { key: K })[],
  opts: { slug?: string; orgName?: string } = {},
): Promise<SeededCompany<K>> {
  const h = await createPeopleHarness(deps, {
    orgName: opts.orgName ?? "Kopi Kaki Pte. Ltd.",
    slug: opts.slug ?? "kopi-kaki",
  });
  const owner = h.actor(OWNER);
  await saveCompanyProfile(h.deps, h.ports, owner, {
    legalName: "Kopi Kaki Pte. Ltd.",
    uen: "201912345K",
    csn: "201912345KPTE01",
    addressBlock: "10",
    addressStreet: "Anson Road",
    addressUnit: "#12-04",
    postalCode: "079903",
  });
  const structure = await seedBasicStructure(h);
  const transport = (
    await createAllowanceType(h.deps, h.ports, owner, { code: "TRANSPORT", name: "Transport allowance" })
  ).id;
  const ctx = ctxFor(h.deps, h.ports, owner);
  const e = {} as Record<K, string>;
  let n = 0;
  for (const p of people) {
    n++;
    const { employeeId } = await hire(
      ctx,
      hirePayload(structure, {
        person: {
          legalName: p.name,
          idType: p.residency === "foreigner" ? "fin" : "nric",
          idNumber: nextNric(p.idPrefix ?? "S"),
          dob: p.dob,
          residencyStatus: p.residency,
          prStartDate: p.prStartDate ?? null,
          sprCpfOption: p.residency === "pr" ? "gg" : null,
          race: p.race ?? "chinese",
          religion: p.religion ?? "buddhism",
          workEmail: `${p.key.toLowerCase()}@kopikaki.example`,
        },
        job: { hireDate: p.hireDate, workScheduleId: structure.scheduleId },
        compensation: { payBasis: "monthly", amountCents: p.basicCents },
        ...(p.key === "A" ? { allowances: [{ allowanceTypeId: transport, amountCents: 20_000 }] } : {}),
        ...(p.pass ? { workPass: { ...p.pass, passNumber: nextNric("G") } } : {}),
        invite: false,
      }),
    );
    e[p.key] = employeeId;
    await setBankAccount(h.deps, h.ports, owner, employeeId, {
      bankCode: n % 2 ? "DBSSSGSG" : "OCBCSGSG",
      accountNumber: String(1_000_000_000 + n * 97_531),
      holderName: p.name,
      effectiveFrom: p.hireDate,
    });
  }
  return { h, structure, allowances: { transport }, e };
}

export async function createPayrollCompany(deps: AppDeps, opts: { slug?: string } = {}): Promise<PayrollCompany> {
  const co = await seedCompany(deps, COMPANY_PEOPLE, opts);
  const { h, e } = co;
  const ctx = ctxFor(h.deps, h.ports, h.actor(OWNER));
  // J resigns: notice given 16 Sep 2026, 30 days → last working day 15 Oct 2026.
  await applyEvent(ctx, e.J, { type: "resignation", noticeGivenOn: "2026-09-16", noticeDays: 30 });
  // K switched to Crow HR in October: January–September 2026 figures from the previous system.
  await h.deps.db.insert(ytdOpeningBalances).values({
    orgId: h.orgId,
    employeeId: e.K,
    year: 2026,
    throughMonth: 9,
    owCents: 7_200_000,
    owCpfCents: 7_200_000,
    awCents: 0,
    awCpfCents: 0,
    cpfEeCents: 1_440_000,
    cpfErCents: 1_224_000,
    shgCents: 2_700,
    sdlCents: 10_125,
  });
  return co;
}
