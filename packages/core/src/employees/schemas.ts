import { z } from "zod";
import { CONTROL_CHARS } from "../export/csv.ts";
import { WORK_PASS_TYPES } from "../organisation/statutory.ts";
import { SG_BANKS } from "./banks.ts";
import { isIsoDate } from "./dates.ts";

/** Shared input schemas: the API, the CSV import and the seed helper all validate through these. */

export const isoDate = z
  .string()
  .trim()
  .refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-10-31." });

const nameText = z.string().refine((v) => !CONTROL_CHARS.test(v), "Remove control characters from the name.");
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max = 200) => z.preprocess(blankToNull, z.string().trim().max(max).nullish());
const optDate = z.preprocess(blankToNull, isoDate.nullish());

/** Non-negative integer cents that stay a safe integer (AGENTS.md rule 4). */
export const centsAmount = z
  .number()
  .int("Amounts are whole cents, e.g. 420000 for S$4,200.00.")
  .min(0, "Amounts cannot be negative.")
  .refine(Number.isSafeInteger, { message: "That amount is too large." });

/** Common races as on the NRIC (suggestions; race is free text so SINDA sub-groups such as Sikh or Tamil are kept as written). */
export const RACES = ["chinese", "malay", "indian", "eurasian", "other"] as const;
const raceText = z.preprocess(
  blankToNull,
  z.string().trim().toLowerCase().max(60, "Use at most 60 characters.").nullish(),
);
export const RELIGIONS = [
  "buddhism",
  "christianity",
  "islam",
  "hinduism",
  "taoism",
  "sikhism",
  "other",
  "none",
  "undisclosed",
] as const;
export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
export const TERMINATION_REASONS = [
  "dismissal",
  "retrenchment",
  "contract_end",
  "retirement",
  "death",
  "mutual_agreement",
] as const;

export const addressInput = z
  .object({
    block: optText(20),
    street: optText(),
    unit: optText(20),
    building: optText(),
    postalCode: optText(10),
    country: z.preprocess(blankToNull, z.string().length(2).toUpperCase().nullish()),
  })
  .superRefine((a, ctx) => {
    const sg = !a.country || a.country === "SG";
    if (sg && a.postalCode && !/^\d{6}$/.test(a.postalCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "Enter a 6-digit Singapore postal code, like 018956.",
      });
    }
  });

const personBase = z.object({
  employeeNumber: optText(20),
  legalName: nameText.trim().min(1, "Enter the legal name as on the NRIC, FIN card or passport.").max(200),
  preferredName: nameText.trim().max(100).nullish(),
  idType: z.enum(["nric", "fin", "other"]),
  idNumber: z.string().trim().min(1, "Enter the NRIC, FIN or passport number."),
  dob: isoDate,
  gender: z.preprocess(blankToNull, z.enum(GENDERS).nullish()),
  nationality: optText(60),
  residencyStatus: z.enum(["citizen", "pr", "foreigner"]),
  prStartDate: optDate,
  sprCpfOption: z.preprocess(blankToNull, z.enum(["gg", "fg", "ff"]).nullish()),
  sprCpfOptionApprovedOn: optDate,
  race: raceText,
  raceSecondary: raceText,
  religion: z.preprocess(blankToNull, z.enum(RELIGIONS).nullish()),
  shgOptOutOn: optDate,
  workEmail: z.preprocess(blankToNull, z.email().nullish()),
  personalEmail: z.preprocess(blankToNull, z.email().nullish()),
  mobile: optText(30),
  address: addressInput.nullish(),
});

/** Cross-field rules shared by create and update. */
export function refinePerson(
  v: Partial<z.output<typeof personBase>>,
  ctx: z.RefinementCtx,
  current?: { residencyStatus: string; prStartDate: string | null },
) {
  const residency = v.residencyStatus ?? current?.residencyStatus;
  const prStart = v.prStartDate !== undefined ? v.prStartDate : current?.prStartDate;
  if (residency === "pr" && !prStart) {
    ctx.addIssue({
      code: "custom",
      path: ["prStartDate"],
      message: "Enter the PR start date (the SPR status date on the ICA entry permit); CPF rates depend on it.",
    });
  }
  if (residency && residency !== "pr" && v.prStartDate) {
    ctx.addIssue({ code: "custom", path: ["prStartDate"], message: "Only permanent residents have a PR start date." });
  }
  if (residency && residency !== "pr" && v.sprCpfOption) {
    ctx.addIssue({ code: "custom", path: ["sprCpfOption"], message: "The CPF rate option applies to SPRs only." });
  }
  if (v.idType === "nric" && residency === "foreigner") {
    ctx.addIssue({ code: "custom", path: ["idType"], message: "Foreign employees have a FIN, not an NRIC." });
  }
}

export const personInput = personBase.superRefine((v, ctx) => refinePerson(v, ctx));
export const personPatch = personBase.partial();
export type PersonInput = z.output<typeof personInput>;

export const emergencyContactInput = z.object({
  name: nameText.trim().min(1, "Enter the contact's name.").max(120),
  relationship: z.string().trim().min(1, "Say how they are related, like Spouse or Parent.").max(60),
  phone: z.string().trim().min(1, "Enter a phone number."),
});

export const emergencyContactsInput = z
  .array(emergencyContactInput)
  .max(3, "At most 3 emergency contacts are allowed. Remove one before adding another.");

export const jobFields = z.object({
  jobTitle: z.string().trim().min(1, "Enter a job title.").max(120),
  departmentId: z.uuid({ message: "Choose a department." }),
  teamId: z.uuid().nullish(),
  locationId: z.uuid().nullish(),
  costCentreId: z.uuid().nullish(),
  managerEmployeeId: z.uuid().nullish(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workScheduleId: z.uuid().nullish(),
  probationEnd: optDate,
  eaCovered: z.boolean().optional(),
  isWorkman: z.boolean().optional(),
});
export type JobFields = z.output<typeof jobFields>;

export const allowanceInput = z.object({
  allowanceTypeId: z.uuid(),
  amountCents: centsAmount,
});

export const compensationInput = z.object({
  payBasis: z.enum(["monthly", "hourly"]),
  amountCents: centsAmount,
  reason: optText(200),
  retroactive: z.boolean().optional(),
});
export type CompensationInput = z.output<typeof compensationInput>;

const passCodes = WORK_PASS_TYPES.map((p) => p.code) as [string, ...string[]];
export const workPassFields = z.object({
  passType: z.enum(passCodes),
  passNumber: optText(30),
  issuedOn: optDate,
  expiresOn: isoDate,
  notes: optText(500),
});
export const workPassInput = workPassFields.refine((p) => !p.issuedOn || p.issuedOn <= p.expiresOn, {
  path: ["expiresOn"],
  message: "The expiry date must be on or after the issue date.",
});
export const workPassPatch = workPassFields.partial().extend({ cancelledOn: optDate });
export type WorkPassInput = z.output<typeof workPassInput>;

const bankCodes = SG_BANKS.map((b) => b.code) as [string, ...string[]];
export const bankAccountInput = z.object({
  bankCode: z.enum(bankCodes),
  accountNumber: z.string().trim().min(1, "Enter the account number."),
  holderName: nameText.trim().min(1, "Enter the account holder's name as the bank has it.").max(140),
  effectiveFrom: isoDate,
});
export type BankAccountInput = z.output<typeof bankAccountInput>;

export const hireInput = z.object({
  person: personInput,
  job: jobFields.extend({ hireDate: isoDate }),
  compensation: compensationInput.omit({ retroactive: true }).nullish(),
  allowances: z.array(allowanceInput).max(20).optional(),
  workPass: workPassInput.nullish(),
  emergencyContacts: emergencyContactsInput.optional(),
  /** Send a sign-in invitation to the work email. Default true when a work email is given. */
  invite: z.boolean().optional(),
});
export type HireInput = z.output<typeof hireInput>;
