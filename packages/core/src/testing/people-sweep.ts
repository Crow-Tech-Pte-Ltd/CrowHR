import { ytdOpeningBalances } from "../db/schema/employees.ts";
import type { AppDeps } from "../deps.ts";
import { type Actor, buildActor } from "../employees/access.ts";
import { submitChangeRequest } from "../employees/change-requests.ts";
import { previewImport } from "../employees/import/service.ts";
import { ctxFor, hire } from "../employees/lifecycle.ts";
import { nricCheckLetter } from "../employees/nric.ts";
import type { PeoplePorts } from "../employees/ports.ts";
import { createAllowanceType, setBankAccount } from "../employees/profile.ts";
import { saveCompanyProfile } from "../organisation/profile.ts";
import { createStructure } from "../organisation/structure.ts";
import { createWorkSchedule } from "../organisation/work-schedules.ts";

/**
 * One row in every people table for the owner's organisation, for cross-organisation sweeps:
 * structure, a hired foreign employee with pass, allowance, emergency contact, bank account,
 * YTD balance, checklist, a pending change request and an import preview. Returns the employee id.
 */
export async function seedPeopleOnePerTable(deps: AppDeps, ports: PeoplePorts, owner: Actor): Promise<string> {
  await saveCompanyProfile(deps, ports, owner, { legalName: "Sweep Pte. Ltd.", uen: "53312345D" });
  const dept = await createStructure(deps, ports, owner, "departments", { name: "Ops" });
  const team = await createStructure(deps, ports, owner, "teams", { name: "Floor", departmentId: dept.id });
  const loc = await createStructure(deps, ports, owner, "locations", { name: "HQ" });
  const cc = await createStructure(deps, ports, owner, "cost-centres", { code: "CC-1", name: "Main" });
  const week = [
    ...Array.from({ length: 5 }, () => ({ type: "working" as const, minutes: 480 })),
    { type: "off" as const, minutes: 0 },
    { type: "rest" as const, minutes: 0 },
  ];
  await createWorkSchedule(deps, ports, owner, { name: "Office", kind: "fixed", days: week });
  const allowance = await createAllowanceType(deps, ports, owner, { code: "TPT", name: "Transport" });
  const fin = `G7000001${nricCheckLetter("G", "7000001")}`;
  const { employeeId } = await hire(ctxFor(deps, ports, owner), {
    person: {
      legalName: "Sweep Person",
      idType: "fin",
      idNumber: fin,
      dob: "1990-01-01",
      residencyStatus: "foreigner",
    },
    job: {
      hireDate: "2026-01-05",
      jobTitle: "Crew",
      departmentId: dept.id,
      teamId: team.id,
      locationId: loc.id,
      costCentreId: cc.id,
      employmentType: "full_time",
    },
    compensation: { payBasis: "monthly", amountCents: 300_000 },
    allowances: [{ allowanceTypeId: allowance.id, amountCents: 10_000 }],
    workPass: { passType: "S_PASS", passNumber: fin, expiresOn: "2028-01-01" },
    emergencyContacts: [{ name: "Kin", relationship: "Spouse", phone: "81234567" }],
    invite: false,
  });
  await setBankAccount(deps, ports, owner, employeeId, {
    bankCode: "DBSSSGSG",
    accountNumber: "0123456789",
    holderName: "Sweep Person",
    effectiveFrom: "2026-01-05",
  });
  await deps.db.insert(ytdOpeningBalances).values({
    orgId: owner.orgId,
    employeeId,
    year: 2026,
    throughMonth: 6,
    owCents: 0,
    awCents: 0,
    cpfEeCents: 0,
    cpfErCents: 0,
    shgCents: 0,
  });
  const self = buildActor({
    db: deps.db,
    orgId: owner.orgId,
    userId: null,
    requestId: null,
    roles: [],
    employeeId,
    today: "2026-10-31",
  });
  await submitChangeRequest(deps, ports, self, { personal: { legalName: "Sweep Person Renamed" } });
  await previewImport(deps, ports, owner, "employees", { name: "x.csv", content: "legal_name\nX\n" });
  return employeeId;
}
