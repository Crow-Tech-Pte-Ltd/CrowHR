import { z } from "zod";
import { sensitive } from "../access/sensitivity.ts";

/** Response schemas for the people API (they are the contract: OpenAPI + strict tests). */

const named = z.object({ id: z.string(), name: z.string() });
const date = z.string().describe("YYYY-MM-DD");

export const statusSchema = z.object({
  code: z.enum(["not_started", "active", "leaving", "former", "no_tenure"]),
  label: z.string(),
  since: z.string().optional(),
  lastWorkingDay: z.string().optional(),
});

export const passStateSchema = z.enum(["valid", "expiring", "expired", "cancelled"]);

export const directoryRowSchema = z.object({
  id: z.string(),
  employeeNumber: z.string(),
  name: z.string(),
  legalName: z.string(),
  preferredName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: named.nullable(),
  team: named.nullable(),
  location: named.nullable(),
  manager: named.nullable(),
  workEmail: z.string().nullable(),
  status: statusSchema,
  workPassState: passStateSchema.nullable(),
  hireDate: z.string().nullable(),
});

export const workPassSchema = z.object({
  id: z.string(),
  passType: z.string(),
  passTypeLabel: z.string(),
  passNumberMasked: sensitive(z.string().nullable(), "nric"),
  issuedOn: z.string().nullable(),
  expiresOn: date,
  cancelledOn: z.string().nullable(),
  notes: z.string().nullable(),
  state: passStateSchema,
});

export const compensationSchema = z.object({
  id: z.string(),
  effectiveFrom: date,
  effectiveTo: z.string().nullable(),
  payBasis: z.enum(["monthly", "hourly"]),
  amountCents: sensitive(z.number().int(), "salary"),
  reason: z.string().nullable(),
  retroactive: z.boolean(),
  eventId: z.string(),
});

export const bankSchema = z.object({
  id: z.string(),
  bankCode: z.string(),
  bankName: z.string(),
  accountLast4: sensitive(z.string(), "bank"),
  holderName: sensitive(z.string(), "bank"),
  effectiveFrom: date,
  effectiveTo: z.string().nullable(),
});

const addressSchema = z
  .object({
    block: z.string().nullish(),
    street: z.string().nullish(),
    unit: z.string().nullish(),
    building: z.string().nullish(),
    postalCode: z.string().nullish(),
    country: z.string().nullish(),
  })
  .nullable();

export const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  effectiveDate: date,
  status: z.enum(["scheduled", "effective", "cancelled"]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const employeeDetailSchema = z.object({
  id: z.string(),
  employeeNumber: z.string(),
  name: z.string(),
  legalName: z.string(),
  preferredName: z.string().nullable(),
  workEmail: z.string().nullable(),
  status: statusSchema,
  job: z
    .object({
      effectiveFrom: date,
      jobTitle: z.string(),
      department: named.nullable(),
      team: named.nullable(),
      location: named.nullable(),
      manager: named.nullable(),
    })
    .nullable(),
  employment: z
    .object({
      costCentre: named.nullable(),
      employmentType: z.string(),
      workSchedule: named.nullable(),
      probationEnd: z.string().nullable(),
      eaCovered: z.boolean(),
      isWorkman: z.boolean(),
      /** Manager or executive: never covered by Employment Act Part 4 (no statutory OT). */
      isManagerOrExecutive: z.boolean(),
      tenures: z.array(
        z.object({
          id: z.string(),
          hireDate: date,
          lastWorkingDay: z.string().nullable(),
          cessationReason: z.string().nullable(),
          noticeDays: z.number().nullable(),
        }),
      ),
      history: z.array(
        z.object({
          id: z.string(),
          effectiveFrom: date,
          effectiveTo: z.string().nullable(),
          jobTitle: z.string(),
          department: z.string().nullable(),
          team: z.string().nullable(),
          location: z.string().nullable(),
          manager: z.string().nullable(),
          employmentType: z.string(),
          eventId: z.string(),
        }),
      ),
      events: z.array(eventSchema),
      directReports: z.array(named),
    })
    .optional(),
  personal: z
    .object({
      idType: z.string(),
      idNumberMasked: sensitive(z.string(), "nric"),
      dob: date,
      age: z.number().int(),
      gender: z.string().nullable(),
      nationality: z.string().nullable(),
      residencyStatus: z.string(),
      prStartDate: z.string().nullable(),
      sprCpfOption: z.string().nullable(),
      sprCpfOptionApprovedOn: z.string().nullable(),
      race: z.string().nullable(),
      raceSecondary: z.string().nullable(),
      religion: z.string().nullable(),
      shgOptOutOn: z.string().nullable(),
      personalEmail: z.string().nullable(),
      mobile: z.string().nullable(),
      address: addressSchema,
    })
    .optional(),
  emergencyContacts: z
    .array(z.object({ id: z.string(), name: z.string(), relationship: z.string(), phone: z.string() }))
    .optional(),
  workPasses: z.array(workPassSchema).optional(),
  compensation: z
    .object({
      current: compensationSchema.nullable(),
      history: z.array(compensationSchema),
      allowances: z.array(
        z.object({
          id: z.string(),
          allowanceTypeId: z.string(),
          name: z.string(),
          amountCents: sensitive(z.number().int(), "salary"),
          effectiveFrom: date,
          effectiveTo: z.string().nullable(),
        }),
      ),
    })
    .optional(),
  bank: z.object({ current: bankSchema.nullable(), history: z.array(bankSchema) }).optional(),
  redactedFields: z.array(z.string()),
});

export const changeRequestSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  routeToRole: z.enum(["hr_admin", "payroll_admin"]),
  fieldNames: z.array(z.string()),
  proposed: z.record(z.string(), z.string().nullable()),
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  decisionNote: z.string().nullable(),
});

export const checklistSchema = z.object({
  id: z.string(),
  kind: z.enum(["onboarding", "offboarding"]),
  status: z.enum(["open", "cancelled"]),
  anchorDate: date,
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      assigneeRole: z.enum(["hr_admin", "payroll_admin", "manager", "employee"]),
      dueOn: date,
      status: z.enum(["open", "done", "skipped", "cancelled"]),
      skipReason: z.string().nullable(),
      doneAt: z.string().nullable(),
    }),
  ),
});

export const importPreviewSchema = z.object({
  jobId: z.string(),
  kind: z.enum(["employees", "compensation", "ytd"]),
  fileName: z.string().nullable(),
  status: z.enum(["previewed", "committed", "failed"]),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), column: z.string(), value: z.string(), message: z.string() })),
  rows: z.array(z.object({ row: z.number().int(), summary: z.string(), valid: z.boolean() })),
  expiresAt: z.string(),
  canCommit: z.boolean(),
});
