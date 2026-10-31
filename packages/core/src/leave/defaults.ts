import { eq } from "drizzle-orm";
import {
  type LeavePolicy,
  type LeaveSettingsRow,
  leaveSettings,
  leaveTypes,
  type StatutoryLeaveCode,
} from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";

/**
 * The leave types every organisation starts with (spec "Preconfigured statutory leave types").
 * Created lazily and idempotently on first use, so organisations created before this change need
 * no backfill (design decision 1). Statutory minimums are enforced in code, not stored here.
 */
export interface DefaultLeaveType {
  code: string;
  name: string;
  statutoryCode: StatutoryLeaveCode | null;
  paid: boolean;
  dayCounting: "working_days" | "working_days_including_holidays";
  halfDays: boolean;
  attachment: "none" | "optional" | "required";
  attachmentLabel: string | null;
  sensitive: boolean;
  policy: LeavePolicy;
  sortOrder: number;
}

const statutory = (overrides: Partial<LeavePolicy> = {}): LeavePolicy => ({
  entitlement: { basis: "statutory" },
  minServiceMonths: 3,
  prorate: false,
  accrual: "upfront",
  carryForward: null,
  encashable: false,
  ...overrides,
});

const unlimited = (): LeavePolicy => ({
  entitlement: { basis: "unlimited" },
  minServiceMonths: 0,
  prorate: false,
  accrual: "upfront",
  carryForward: null,
  encashable: false,
});

/** Parental schemes are taken in working days and count holidays inside the period (spec "Working-day calculation"). */
const PARENTAL = { dayCounting: "working_days_including_holidays", halfDays: false } as const;

export const DEFAULT_LEAVE_TYPES: readonly DefaultLeaveType[] = [
  {
    code: "annual",
    name: "Annual leave",
    statutoryCode: "annual",
    paid: true,
    dayCounting: "working_days",
    halfDays: true,
    attachment: "none",
    attachmentLabel: null,
    sensitive: false,
    // Part 4 employees must be allowed to carry unused statutory leave forward for 12 months
    // (https://www.mom.gov.sg/employment-practices/leave/annual-leave/special-situations).
    policy: statutory({ prorate: true, carryForward: { maxDays: null, expiresAfterMonths: 12 } }),
    sortOrder: 10,
  },
  {
    code: "sick_outpatient",
    name: "Sick leave (outpatient)",
    statutoryCode: "sick_outpatient",
    paid: true,
    dayCounting: "working_days",
    halfDays: true,
    attachment: "required",
    attachmentLabel: "Medical certificate (MC)",
    sensitive: true,
    policy: statutory(),
    sortOrder: 20,
  },
  {
    code: "hospitalisation",
    name: "Hospitalisation leave",
    statutoryCode: "hospitalisation",
    paid: true,
    dayCounting: "working_days",
    halfDays: true,
    attachment: "required",
    attachmentLabel: "Hospitalisation certificate or MC",
    sensitive: true,
    policy: statutory(),
    sortOrder: 30,
  },
  {
    code: "childcare",
    name: "Childcare leave",
    statutoryCode: "childcare",
    paid: true,
    dayCounting: "working_days",
    halfDays: true,
    attachment: "none",
    attachmentLabel: null,
    sensitive: false,
    policy: statutory(),
    sortOrder: 40,
  },
  {
    code: "extended_childcare",
    name: "Extended childcare leave",
    statutoryCode: "extended_childcare",
    paid: true,
    dayCounting: "working_days",
    halfDays: true,
    attachment: "none",
    attachmentLabel: null,
    sensitive: false,
    policy: statutory(),
    sortOrder: 41,
  },
  {
    code: "maternity",
    name: "Maternity leave",
    statutoryCode: "maternity",
    paid: true,
    ...PARENTAL,
    attachment: "optional",
    attachmentLabel: "Birth certificate or doctor's letter",
    sensitive: true,
    policy: statutory(),
    sortOrder: 50,
  },
  {
    code: "paternity",
    name: "Paternity leave",
    statutoryCode: "paternity",
    paid: true,
    ...PARENTAL,
    attachment: "optional",
    attachmentLabel: "Birth certificate",
    sensitive: false,
    policy: statutory(),
    sortOrder: 51,
  },
  {
    code: "shared_parental",
    name: "Shared parental leave",
    statutoryCode: "shared_parental",
    paid: true,
    ...PARENTAL,
    attachment: "optional",
    attachmentLabel: "Birth certificate",
    sensitive: false,
    policy: statutory(),
    sortOrder: 52,
  },
  {
    code: "adoption",
    name: "Adoption leave",
    statutoryCode: "adoption",
    paid: true,
    ...PARENTAL,
    attachment: "optional",
    attachmentLabel: "Formal intent to adopt",
    sensitive: false,
    policy: statutory(),
    sortOrder: 53,
  },
  {
    code: "infant_care",
    name: "Unpaid infant care leave",
    statutoryCode: "infant_care",
    paid: false,
    dayCounting: "working_days",
    halfDays: true,
    attachment: "none",
    attachmentLabel: null,
    sensitive: true,
    policy: statutory(),
    sortOrder: 54,
  },
  {
    code: "ns",
    name: "NS (reservist) leave",
    statutoryCode: "ns",
    paid: true,
    dayCounting: "working_days",
    halfDays: false,
    attachment: "required",
    attachmentLabel: "NS call-up notice",
    sensitive: false,
    policy: unlimited(),
    sortOrder: 60,
  },
  {
    code: "compassionate",
    name: "Compassionate leave",
    statutoryCode: null,
    paid: true,
    dayCounting: "working_days",
    halfDays: false,
    attachment: "none",
    attachmentLabel: null,
    sensitive: true,
    policy: {
      entitlement: { basis: "fixed", days: 3 },
      minServiceMonths: 0,
      prorate: false,
      accrual: "upfront",
      carryForward: null,
      encashable: false,
    },
    sortOrder: 70,
  },
  {
    code: "no_pay",
    name: "No-pay leave",
    statutoryCode: "no_pay",
    paid: false,
    dayCounting: "working_days",
    halfDays: true,
    attachment: "none",
    attachmentLabel: null,
    sensitive: true,
    policy: unlimited(),
    sortOrder: 90,
  },
];

/** Types whose entitlement is per child rather than per leave year. */
export const PER_CHILD_CODES: ReadonlySet<StatutoryLeaveCode> = new Set([
  "maternity",
  "paternity",
  "shared_parental",
  "adoption",
]);

/** Types whose application must name a child. */
export const NEEDS_CHILD_CODES: ReadonlySet<StatutoryLeaveCode> = new Set([...PER_CHILD_CODES, "infant_care"]);

const ready = new WeakMap<object, Set<string>>();

/** Creates the default types and settings row for the org if missing. Idempotent; cheap after the first call. */
export async function ensureLeaveSetup(deps: Pick<AppDeps, "ids" | "db">, orgId: string): Promise<void> {
  const db = deps.db;
  const seen = ready.get(deps) ?? new Set<string>();
  ready.set(deps, seen);
  if (seen.has(orgId)) return;
  await db
    .insert(leaveTypes)
    .values(DEFAULT_LEAVE_TYPES.map((t) => ({ id: deps.ids.newId(), orgId, ...t })))
    .onConflictDoNothing({ target: [leaveTypes.orgId, leaveTypes.code] });
  await db.insert(leaveSettings).values({ orgId }).onConflictDoNothing();
  seen.add(orgId);
}

export async function loadLeaveSettings(db: Db, orgId: string): Promise<LeaveSettingsRow> {
  const [row] = await db.select().from(leaveSettings).where(eq(leaveSettings.orgId, orgId));
  return (
    row ?? {
      orgId,
      offDayHoliday: "extra_pay",
      unpaidServiceRule: "whole_month",
      fullTimeScheduleId: null,
      updatedAt: new Date(0),
    }
  );
}
