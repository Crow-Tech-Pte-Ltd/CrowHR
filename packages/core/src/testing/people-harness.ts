import { orgSecuritySettings } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { type Actor, buildActor } from "../employees/access.ts";
import { singaporeToday } from "../employees/dates.ts";
import { nricCheckLetter } from "../employees/nric.ts";
import { createStructure } from "../organisation/structure.ts";
import { createWorkSchedule } from "../organisation/work-schedules.ts";
import { createTestPeoplePorts, type TestPeoplePorts } from "./people-doubles.ts";

/**
 * Small harness for people-module tests and seeding: an organisation, the
 * test ports and an `actor(roles, employeeId?)` builder. Runtime-agnostic so
 * the demo can reuse it.
 */
export interface PeopleHarness {
  orgId: string;
  ports: TestPeoplePorts;
  deps: AppDeps & { people: TestPeoplePorts };
  actor(roles: string[], employeeId?: string | null, userId?: string): Actor;
}

export async function createPeopleHarness(
  deps: AppDeps,
  opts: { orgName?: string; slug?: string; ports?: TestPeoplePorts } = {},
): Promise<PeopleHarness> {
  const orgId = deps.ids.newId();
  await deps.db
    .insert(organisations)
    .values({ id: orgId, name: opts.orgName ?? "Kopi Kaki Pte. Ltd.", slug: opts.slug ?? `org-${orgId.slice(-8)}` });
  await deps.db.insert(orgSecuritySettings).values({ orgId });
  const existing = (deps as AppDeps & { people?: TestPeoplePorts }).people;
  const ports = opts.ports ?? existing ?? createTestPeoplePorts();
  const withPorts = Object.assign(deps, { people: ports });
  return {
    orgId,
    ports,
    deps: withPorts,
    actor(roles, employeeId = null, userId) {
      return buildActor({
        db: deps.db as Db,
        orgId,
        userId: userId ?? deps.ids.newId(),
        requestId: null,
        roles,
        employeeId,
        today: singaporeToday(deps.clock.now()),
      });
    },
  };
}

export const OWNER = ["owner"];
export const HR = ["hr_admin"];
export const PAYROLL = ["payroll_admin"];

export interface BasicStructure {
  departments: Record<"sales" | "ops" | "finance", string>;
  scheduleId: string;
  locationId: string;
}

export const OFFICE_WEEK = [
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "off", minutes: 0 },
  { type: "rest", minutes: 0 },
] as const;

/** Departments Sales/Operations/Finance, one location and a default Mon–Fri schedule. */
export async function seedBasicStructure(h: PeopleHarness): Promise<BasicStructure> {
  const owner = h.actor(OWNER);
  const mk = (name: string) => createStructure(h.deps, h.ports, owner, "departments", { name });
  const sales = await mk("Sales");
  const ops = await mk("Operations");
  const finance = await mk("Finance");
  const location = await createStructure(h.deps, h.ports, owner, "locations", {
    name: "Tanjong Pagar HQ",
    address: "1 Tanjong Pagar Plaza",
    postalCode: "082001",
  });
  const schedule = await createWorkSchedule(h.deps, h.ports, owner, {
    name: "Office 5-day",
    kind: "fixed",
    days: OFFICE_WEEK.map((d) => ({ ...d })),
  });
  return {
    departments: { sales: sales.id, ops: ops.id, finance: finance.id },
    scheduleId: schedule.id,
    locationId: location.id,
  };
}

let nricSeq = 1_000_000;
/** A fresh valid NRIC/FIN per call (fictional). */
export function nextNric(prefix: "S" | "T" | "F" | "G" | "M" = "S"): string {
  nricSeq += 7919;
  const digits = String(nricSeq % 10_000_000).padStart(7, "0");
  return `${prefix}${digits}${nricCheckLetter(prefix, digits)}`;
}

/** A minimal valid hire payload for a citizen; override any part. */
export function hirePayload(
  s: BasicStructure,
  overrides: {
    person?: Record<string, unknown>;
    job?: Record<string, unknown>;
    compensation?: Record<string, unknown> | null;
    [k: string]: unknown;
  } = {},
) {
  const { person, job, compensation, ...rest } = overrides;
  return {
    person: {
      legalName: "Tan Mei Ling",
      idType: "nric",
      idNumber: nextNric(),
      dob: "1990-04-12",
      residencyStatus: "citizen",
      race: "chinese",
      religion: "buddhism",
      ...person,
    },
    job: {
      hireDate: "2026-01-05",
      jobTitle: "Account Executive",
      departmentId: s.departments.sales,
      locationId: s.locationId,
      employmentType: "full_time",
      ...job,
    },
    compensation: compensation === undefined ? { payBasis: "monthly", amountCents: 400_000 } : compensation,
    ...rest,
  };
}
