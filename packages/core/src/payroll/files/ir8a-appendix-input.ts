import { z } from "zod";

/**
 * What HR enters for IR8A Appendix 8A and 8B (add-ir8a-appendix-8a-8b). The same schema validates
 * the API body and the stored `details` jsonb. Field names avoid the audit log's secret-key filter
 * (`pass`, `private`, `token`…), so changes show in audit diffs.
 */

const isoDate = z.iso.date();
/** Appendix 8A amounts: integer cents, at most $9,999,999.99 (AIS "Decimals (7,2)"). */
const amount = z
  .number()
  .int("Enter whole cents.")
  .min(0, "Amounts can't be negative.")
  .max(999_999_999, "IRAS's Appendix 8A accepts at most $9,999,999.99 per item.");
const note = z.string().trim().max(200).nullable().default(null);
/** Share prices and counts in S$: up to 9 digits and 5 decimal places (AIS "Decimals (9,5)"). */
const decimal = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,5})?$/, "Use a number with at most 9 digits and 5 decimal places, e.g. 12.5.");

export const residenceInput = z.object({
  kind: z.literal("residence"),
  basis: z
    .enum(["rented", "owned", "none"])
    .describe(
      "rented: the employer pays rent; owned: no rent (annual value basis); none: utilities, driver or servant only",
    ),
  address: z.string().trim().max(115).nullable().default(null),
  occupiedFrom: isoDate.nullable().default(null),
  occupiedTo: isoDate.nullable().default(null),
  employeesSharing: z.number().int().min(1).max(999).default(1),
  rentPaidByEmployerCents: amount.nullable().default(null).describe("Rent for the period, whole premises"),
  annualValueCents: amount.nullable().default(null).describe("The premises' annual value (owned)"),
  annualValueForPeriodCents: amount
    .nullable()
    .default(null)
    .describe("2a entered instead of computed (AV revised during the year, or a leap year)"),
  furnishing: z.enum(["partial", "full"]).nullable().default(null),
  rentPaidByEmployeeCents: amount.default(0),
  utilitiesCents: amount.default(0),
  driverAnnualCostCents: amount.default(0),
  driverPersonalKm: z.number().int().min(0).nullable().default(null).describe("Private mileage"),
  driverTotalKm: z.number().int().min(0).nullable().default(null),
  servantCents: amount.default(0),
  note,
});

export const hotelInput = z.object({
  kind: z.literal("hotel"),
  costCents: amount,
  paidByEmployeeCents: amount.default(0),
  note,
});

export const carInput = z.object({
  kind: z.literal("car"),
  carType: z.enum(["new", "second_hand", "renewed_coe", "leased"]),
  usedFrom: isoDate,
  usedTo: isoDate,
  costCents: amount.nullable().default(null).describe("Car cost with COE; for a renewed COE, the renewal amount"),
  parfRebateCents: amount.nullable().default(null).describe("PARF rebate; for a renewed COE, the rebate forgone"),
  coeYears: z.number().int().min(1).max(10).nullable().default(null),
  rentalCents: amount.nullable().default(null),
  runningCostsCents: amount.default(0),
  note,
});

/** Appendix 8A items 4a–4h and 4j, entered as amounts. */
export const OTHER_BENEFIT_ITEMS = {
  home_leave: { code: "4a", label: "Home leave passages and incidental benefits" },
  loan_interest: { code: "4b", label: "Interest paid by the employer or interest benefit on a loan" },
  insurance: { code: "4c", label: "Insurance premiums paid by the employer" },
  holiday: { code: "4d", label: "Free or subsidised holidays, including air passages" },
  education: { code: "4e", label: "Educational expenses, including a tutor" },
  club: { code: "4f", label: "Club entrance or transfer fees and subscriptions" },
  asset_gain: { code: "4g", label: "Gains from assets sold below market value" },
  vehicle_given: { code: "4h", label: "Full cost of a motor vehicle given" },
  other: { code: "4j", label: "Other non-monetary awards or benefits" },
} as const;
export type OtherBenefitItem = keyof typeof OTHER_BENEFIT_ITEMS;

export const otherInput = z.object({
  kind: z.literal("other"),
  item: z.enum(Object.keys(OTHER_BENEFIT_ITEMS) as [OtherBenefitItem, ...OtherBenefitItem[]]),
  amountCents: amount.min(1, "Enter the cost of the benefit."),
  note,
});

export const shareGainInput = z
  .object({
    kind: z.literal("share_gain"),
    planType: z.enum(["ESOP", "ESOW"]),
    grantedOn: isoDate,
    eventDate: isoDate.describe("Exercise, vesting, or moratorium lifted (the date the gain accrues)"),
    exercisePrice: decimal.describe("S$ per share (0 for free shares)"),
    openMarketValue: decimal.describe("S$ per share on the event date"),
    shares: decimal,
    companyIdType: z.enum(["UEN-Local Co", "UEN-Others", "OTHERS"]).nullable().default(null),
    companyIdNumber: z.string().trim().max(25).nullable().default(null),
    companyName: z.string().trim().max(100).nullable().default(null),
    note,
  })
  .superRefine((v, ctx) => {
    const any = v.companyIdType || v.companyIdNumber || v.companyName;
    const all = v.companyIdType && v.companyIdNumber && v.companyName;
    if (any && !all)
      ctx.addIssue({
        code: "custom",
        path: ["companyName"],
        message:
          "Fill in the granting company's ID type, number and name, or leave all three empty when the employer granted the plan.",
      });
  });

export const appendixEntryInput = z.discriminatedUnion("kind", [
  residenceInput,
  hotelInput,
  carInput,
  otherInput,
  shareGainInput,
]);
export type AppendixEntryDetails = z.output<typeof appendixEntryInput>;
export type AppendixEntryKind = AppendixEntryDetails["kind"];

export const createAppendixEntryInput = z.object({
  employeeId: z.uuid(),
  entry: appendixEntryInput,
});
