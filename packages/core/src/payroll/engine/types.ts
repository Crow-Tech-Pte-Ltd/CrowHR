/**
 * Payroll engine wire types. The input snapshot is everything `computeEmployeePay` reads: it is
 * stored per employee per run, hashed, and recomputing it gives a byte-identical result (spec
 * payroll-run "Deterministic and persisted computation"). Plain JSON only: no Dates, no undefined.
 */
import type { CpfResidency, CpfYearToDate, ShgFund, WorkPattern } from "@crowhr/sg-rules";
import type { DeductionCategory } from "../rules.ts";

export const ENGINE_VERSION = 1;

export type RunKind = "regular" | "off_cycle" | "adjustment";
export type OffCycleReason = "final_pay" | "bonus";

/**
 * A bonus run, or an adjustment that reopens one (the adjustment keeps the original's reason): it
 * pays only its items, never basic pay, allowances, FWL or the module feeds (claims, OT, leave).
 */
export function isBonusRun(run: { kind: RunKind; offCycleReason: OffCycleReason | null }): boolean {
  return (run.kind === "off_cycle" || run.kind === "adjustment") && run.offCycleReason === "bonus";
}
export type WageClass = "OW" | "AW";

export type RunItemKind =
  | "bonus"
  | "commission"
  | "backpay"
  | "other_earning"
  | "overtime"
  | "unpaid_leave"
  | "hours"
  | "deduction"
  /** Rostered staff: working days the roster required in the month (incl. public holidays). */
  | "scheduled_days"
  /** Rostered staff: days worked (incl. public holidays and paid leave; excl. no-pay leave). */
  | "days_worked"
  /** Recover the employee share of AW top-up CPF (CPF Act s 7(9)); amount null = all recoverable. */
  | "cpf_aw_recovery";

/** One manual input on a run (or fed from a source port). */
export interface RunItemInput {
  id: string;
  kind: RunItemKind;
  label: string;
  /** Earnings and deductions. For `overtime`: an entered contractual amount (null = statutory formula). */
  amountCents: number | null;
  /** Earnings: OW or AW. */
  wageClass: WageClass | null;
  /** Earnings: CPF-liable (genuine reimbursements entered here are not). */
  cpfLiable: boolean;
  /** AW: the date the AW became due and payable (keys CPF's AW regime). */
  awPayableDate: string | null;
  /** Overtime minutes, or hours worked (minutes) for hourly-rated staff. */
  minutes: number | null;
  /** Unpaid leave days (multiples of 0.5) and optional date (selects the compensation segment). */
  days: number | null;
  date: string | null;
  /** Overtime period when different from the salary period. */
  periodStart: string | null;
  periodEnd: string | null;
  deductionCategory: DeductionCategory | null;
  /** Where it came from: manual entry or a source port (attendance, claims). */
  source: "manual" | "attendance" | "leave";
  /** Snapshotted leave rate basis, shown in payslip working. */
  rateExplanation?: string;
}

export interface CompensationSegment {
  from: string;
  /** Exclusive; null = open. */
  to: string | null;
  payBasis: "monthly" | "hourly";
  amountCents: number;
}

export interface AllowanceInput {
  grossRateIncluded?: boolean | null;
  id: string;
  code: string;
  name: string;
  amountCents: number;
  from: string;
  to: string | null;
  cpfLiable: boolean;
  prorate: boolean;
}

export interface ReimbursementInput {
  /** Snapshotted at compute: taxable cash reimbursement (IR8A d1), independent of CPF wages. */
  taxable?: boolean;
  claimId: string;
  typeName: string;
  amountCents: number;
}

/** Amounts already charged for this employee by earlier runs of the same month. */
export interface MonthCharged {
  cpfTotalCents: number;
  /** Statutory employee share, including the employee share of any AW top-up (shortfall). */
  cpfEmployeeCents: number;
  /** The part of `cpfEmployeeCents` that is the employee share of an AW top-up on earlier AW. */
  cpfAwTopUpEmployeeCents: number;
  cpfEmployerCents: number;
  shgCents: Partial<Record<ShgFund, number>>;
  sdlUnits1e4Cent: number;
}

export interface MonthBefore {
  /** CPF-liable OW / AW and all wages paid in earlier effective runs of the month. */
  owCpfCents: number;
  awCpfCents: number;
  totalWagesCents: number;
  /** Charged by earlier effective runs of the month that this run does not replace. */
  chargedByOthers: MonthCharged;
  /** Charged by the run(s) this adjustment replaces (zero for other runs). */
  chargedByReplaced: MonthCharged;
  /** Net already paid by the run(s) this adjustment replaces (0 otherwise). */
  netPaidByReplacedCents: number;
  /** Run ids that contributed (for the working). */
  runIds: string[];
}

export interface PayInput {
  engineVersion: number;
  run: {
    id: string;
    kind: RunKind;
    offCycleReason: OffCycleReason | null;
    month: string;
    periodStart: string;
    periodEnd: string;
    payDate: string;
  };
  employer: { legalName: string | null };
  employee: {
    id: string;
    employeeNumber: string;
    legalName: string;
    idMasked: string;
    dob: string;
    residency: CpfResidency;
    /** Race components as recorded (first decides the SHG fund), religion and SHG opt-out. */
    race: string[];
    isMuslim: boolean;
    shgOptedOut: boolean;
    workPass: { type: string; issuedOn: string | null; expiresOn: string; cancelledOn: string | null } | null;
    isWorkman: boolean;
    /** Manager or executive: never Part 4. Absent (false) in snapshots taken before the flag existed. */
    isManagerOrExecutive?: boolean;
  };
  employment: {
    hireDate: string;
    lastWorkingDay: string | null;
    cessationReason: string | null;
    /** Sunday-first working-day pattern; null for shift schedules (5-day pattern assumed, with a warning). */
    pattern: WorkPattern | null;
    weeklyMinutes: number | null;
    jobTitle: string | null;
    department: string | null;
  };
  compensation: CompensationSegment[];
  allowances: AllowanceInput[];
  items: RunItemInput[];
  reimbursements: ReimbursementInput[];
  /** CPF year-to-date state before this month (sg-rules `CpfYearToDate`). */
  cpfStateBefore: CpfYearToDate;
  /** Where `cpfStateBefore` came from, for the working. */
  cpfStateSource: string;
  monthBefore: MonthBefore | null;
  fwl: { sector: string; tier: string; skill: string | null } | null;
  /**
   * Employee shares of AW top-ups charged in earlier runs not yet recovered from pay, oldest first,
   * with the CPF Act s 7(9) recovery deadline of each.
   */
  awRecoveryOpen: { month: string; openCents: number; deadline: string }[];
  /** Problems found while gathering the snapshot (e.g. PR without a start date). */
  snapshotIssues: PayIssue[];
}

export type LineKind = "earning" | "deduction" | "reimbursement" | "employer";
export type LineCategory =
  | "basic"
  | "npl"
  | "allowance"
  | "overtime"
  | "additional"
  | "cpf_employee"
  | "shg"
  | "deduction"
  | "claim"
  | "cpf_employer"
  | "sdl"
  | "fwl";

export interface PayLine {
  code: string;
  kind: LineKind;
  category: LineCategory;
  label: string;
  /** Positive amount; `kind` says whether it adds or subtracts. */
  amountCents: number;
  wageClass: WageClass | null;
  cpfLiable: boolean;
  /** e.g. "12 of 22 working days", "4.5 h", "AW payable 15 Dec 2026". */
  detail: string | null;
  itemId: string | null;
}

export type IssueSeverity = "info" | "warning" | "blocking";

/**
 * What an issue is about, so a client can open the place that fixes it. Set only when known; a key
 * is left out rather than set to undefined (the snapshot is plain JSON).
 */
export interface IssueRef {
  /** The run item: a manual item's ID, or a fed item's ID (`attendance:<overtime claim ID>` for approved overtime). */
  itemId?: string;
  /** The public holiday an off-day holiday pay issue is about. */
  holidayDate?: string;
  holidayName?: string;
  /** Allowance type codes still to classify for the gross rate of pay. */
  allowanceCodes?: string[];
}

export interface PayIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  source: string | null;
  ref?: IssueRef;
}

export type WorkingSection = "basic" | "allowances" | "overtime" | "cpf" | "shg" | "sdl" | "fwl" | "deductions" | "pay";

export interface WorkingLine {
  section: WorkingSection;
  code: string;
  text: string;
}

/** A rule version used, for "shows its working": what, effective from/to, and the source. */
export interface RuleRef {
  family: string;
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
}

export interface PayResult {
  engineVersion: number;
  lines: PayLine[];
  totals: {
    basicCents: number;
    nplCents: number;
    allowancesCents: number;
    overtimeCents: number;
    additionalCents: number;
    /** All earnings (wages) of this run, after no-pay leave. */
    grossCents: number;
    reimbursementsCents: number;
    owCpfCents: number;
    awCpfCents: number;
    totalWagesCents: number;
    cpfEmployeeCents: number;
    cpfEmployerCents: number;
    shgCents: number;
    otherDeductionsCents: number;
    employeeDeductionsCents: number;
    netCents: number;
    /** Net to pay now: net, or for an adjustment net − net already paid by the replaced run(s). */
    netPayableCents: number;
    /** Employee share of AW top-ups recovered from this pay (CPF Act s 7(9)). */
    cpfAwRecoveredCents: number;
    /** Employee share of this run's AW top-up the employer bears (not recovered). Not statutory employer CPF. */
    cpfEmployeeShareAbsorbedCents: number;
    sdlUnits1e4Cent: number;
    fwlCents: number;
    employerCostCents: number;
  };
  /** Cumulative figures for the whole month (this run plus earlier effective runs). */
  month: {
    owCpfCents: number;
    awCpfCents: number;
    totalWagesCents: number;
    cpfTotalCents: number;
    cpfEmployeeCents: number;
    cpfEmployerCents: number;
    shgCents: Partial<Record<ShgFund, number>>;
    sdlUnits1e4Cent: number;
  };
  /** Charged by this run = month − charged by earlier runs. */
  charged: MonthCharged;
  cpf: {
    residencyCategory: string;
    ageBand: string | null;
    ageBandLabel: string | null;
    rateTableId: string | null;
    wageBand: string | null;
    owSubjectCents: number;
    awSubjectCents: number;
    awNotSubjectCents: number;
    awCeiling: {
      basis: string;
      annualOwSubjectCents: number;
      annualAwCeilingCents: number;
      headroomBeforeCents: number;
      headroomAfterCents: number;
    } | null;
    priorAwShortfallCents: number;
    priorAwExcessCents: number;
    exactTotal: string;
    exactEmployee: string;
  } | null;
  shgFunds: ShgFund[];
  overtime: {
    minutes: number;
    /** Each OT entry with its own period (MOM payslip item 11), hours and pay. */
    periods: {
      label: string;
      periodStart: string | null;
      periodEnd: string | null;
      minutes: number;
      payCents: number;
    }[];
  } | null;
  /** AW top-up (prior-AW shortfall) employee share and how it was handled. */
  awTopUp: {
    employeeShareCents: number;
    recoveredThisRunCents: number;
    recoveredEarlierCents: number;
    absorbedCents: number;
    deadline: string;
  } | null;
  hourly: { rateCents: number; minutes: number } | null;
  rules: RuleRef[];
  working: WorkingLine[];
  issues: PayIssue[];
  /** CPF YTD state after this month (persisted and passed to the next month). */
  stateAfter: CpfYearToDate;
}
