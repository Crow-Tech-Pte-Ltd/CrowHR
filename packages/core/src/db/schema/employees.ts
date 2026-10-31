import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { costCentres, departments, locations, teams, workSchedules } from "./organisation.ts";
import { organisations } from "./organisations.ts";

/**
 * Employee record (add-organisation-and-people). See `organisation.ts` for the
 * shared conventions (org_id everywhere, composite FKs, archive not delete).
 *
 * Effective-dated tables use half-open `[effective_from, effective_to)` date
 * ranges; `effective_to` null means open-ended. Non-overlap is enforced by the
 * service layer (`employees/effective.ts`) and tested.
 *
 * Sensitive identifiers (NRIC/FIN, work pass and bank numbers) are stored only
 * as SecretBox ciphertext (`*_enc`), a keyed blind index (`*_hmac`) for exact
 * match and duplicate detection, and a pre-computed mask for display.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" });

const cents = (name: string) => bigint(name, { mode: "number" });

export type IdType = "nric" | "fin" | "other";
export type ResidencyStatus = "citizen" | "pr" | "foreigner";
/** CPF contribution option for SPRs in their 1st/2nd year (G/G default; F/G and F/F by joint application). */
export type SprCpfOption = "gg" | "fg" | "ff";
export type Gender = "female" | "male" | "other" | "undisclosed";

export interface EmployeeAddress {
  block?: string | null;
  street?: string | null;
  unit?: string | null;
  building?: string | null;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2; defaults to SG. */
  country?: string | null;
}

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeNumber: text("employee_number").notNull(),
    legalName: text("legal_name").notNull(),
    preferredName: text("preferred_name"),
    idType: text("id_type").$type<IdType>().notNull(),
    idNumberEnc: text("id_number_enc").notNull(),
    idNumberHmac: text("id_number_hmac").notNull(),
    /** Display mask, e.g. `S****567D`. Never the full value. */
    idNumberMasked: text("id_number_masked").notNull(),
    dob: date("dob").notNull(),
    gender: text("gender").$type<Gender>(),
    nationality: text("nationality"),
    residencyStatus: text("residency_status").$type<ResidencyStatus>().notNull(),
    prStartDate: date("pr_start_date"),
    sprCpfOption: text("spr_cpf_option").$type<SprCpfOption>(),
    sprCpfOptionApprovedOn: date("spr_cpf_option_approved_on"),
    /** Race as on the NRIC; for double-barrelled races the first component. */
    race: text("race"),
    raceSecondary: text("race_secondary"),
    religion: text("religion"),
    /** Date the employee's SHG opt-out form was given to the employer; null = contributing. */
    shgOptOutOn: date("shg_opt_out_on"),
    workEmail: text("work_email"),
    personalEmail: text("personal_email"),
    mobileE164: text("mobile_e164"),
    address: jsonb("address").$type<EmployeeAddress>(),
    photoFileKey: text("photo_file_key"),
    ...timestamps,
  },
  (t) => [
    unique("employees_org_id_id_unique").on(t.orgId, t.id),
    unique("employees_org_number_unique").on(t.orgId, t.employeeNumber),
    unique("employees_org_id_hmac_unique").on(t.orgId, t.idNumberHmac),
    index("employees_org_work_email").on(t.orgId, sql`lower(${t.workEmail})`),
  ],
);

const employeeFk = (name: string, t: { orgId: AnyPgColumn; employeeId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [t.orgId, t.employeeId],
    foreignColumns: [employees.orgId, employees.id],
  }).onDelete("cascade");

export const emergencyContacts = pgTable(
  "emergency_contacts",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    phoneE164: text("phone_e164").notNull(),
    position: smallint("position").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("emergency_contacts_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("emergency_contacts_employee_fk", t),
  ],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    /** SWIFT/BIC-style short code from the maintained SG bank list, e.g. `DBSSSGSG`. */
    bankCode: text("bank_code").notNull(),
    accountNumberEnc: text("account_number_enc").notNull(),
    accountNumberHmac: text("account_number_hmac").notNull(),
    accountLast4: text("account_last4").notNull(),
    holderName: text("holder_name").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("bank_accounts_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("bank_accounts_employee_fk", t),
    index("bank_accounts_lookup").on(t.orgId, t.employeeId, t.effectiveFrom),
  ],
);

export const workPasses = pgTable(
  "work_passes",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    passType: text("pass_type").notNull(),
    passNumberEnc: text("pass_number_enc"),
    passNumberMasked: text("pass_number_masked"),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on").notNull(),
    cancelledOn: date("cancelled_on"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    unique("work_passes_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("work_passes_employee_fk", t),
    index("work_passes_expiry").on(t.orgId, t.expiresOn),
  ],
);

export type CessationReason =
  | "resignation"
  | "dismissal"
  | "retrenchment"
  | "contract_end"
  | "retirement"
  | "death"
  | "mutual_agreement";

/** One continuous period of employment. A rehire opens a second tenure on the same employee. */
export const tenures = pgTable(
  "tenures",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    hireDate: date("hire_date").notNull(),
    lastWorkingDay: date("last_working_day"),
    noticeGivenOn: date("notice_given_on"),
    noticeDays: integer("notice_days"),
    cessationReason: text("cessation_reason").$type<CessationReason>(),
    cessationEventId: uuid("cessation_event_id"),
    /** When the membership `former` transition ran for this tenure (idempotent sweep). */
    formerTransitionAt: timestamp("former_transition_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("tenures_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("tenures_employee_fk", t),
    index("tenures_employee").on(t.orgId, t.employeeId, t.hireDate),
  ],
);

export type LifecycleEventType =
  | "hire"
  | "transfer"
  | "promotion"
  | "salary_change"
  | "probation_confirmed"
  | "resignation"
  | "termination"
  | "rehire";

export const lifecycleEvents = pgTable(
  "lifecycle_events",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    tenureId: uuid("tenure_id"),
    type: text("type").$type<LifecycleEventType>().notNull(),
    effectiveDate: date("effective_date").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Acting user id. Plain uuid until memberships exist (identity workstream). */
    createdBy: uuid("created_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("lifecycle_events_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("lifecycle_events_employee_fk", t),
    foreignKey({
      name: "lifecycle_events_tenure_fk",
      columns: [t.orgId, t.tenureId],
      foreignColumns: [tenures.orgId, tenures.id],
    }),
    index("lifecycle_events_employee").on(t.orgId, t.employeeId, t.effectiveDate),
  ],
);

export type EmploymentType = "full_time" | "part_time" | "contract" | "intern";

export const employmentRecords = pgTable(
  "employment_records",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    tenureId: uuid("tenure_id").notNull(),
    eventId: uuid("event_id").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    jobTitle: text("job_title").notNull(),
    departmentId: uuid("department_id").notNull(),
    teamId: uuid("team_id"),
    locationId: uuid("location_id"),
    costCentreId: uuid("cost_centre_id"),
    managerEmployeeId: uuid("manager_employee_id"),
    employmentType: text("employment_type").$type<EmploymentType>().notNull(),
    workScheduleId: uuid("work_schedule_id").notNull(),
    probationEnd: date("probation_end"),
    eaCovered: boolean("ea_covered").notNull().default(true),
    isWorkman: boolean("is_workman").notNull().default(false),
    /**
     * Manager or executive (Employment Act s 2: executive and supervisory or managerial
     * responsibilities). Never covered by Part 4 (overtime, rest days, hours), whatever the pay.
     * https://www.mom.gov.sg/employment-practices/employment-act/who-is-covered
     */
    isManagerOrExecutive: boolean("is_manager_executive").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("employment_records_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("employment_records_employee_fk", t),
    foreignKey({
      name: "employment_records_tenure_fk",
      columns: [t.orgId, t.tenureId],
      foreignColumns: [tenures.orgId, tenures.id],
    }),
    foreignKey({
      name: "employment_records_event_fk",
      columns: [t.orgId, t.eventId],
      foreignColumns: [lifecycleEvents.orgId, lifecycleEvents.id],
    }),
    foreignKey({
      name: "employment_records_department_fk",
      columns: [t.orgId, t.departmentId],
      foreignColumns: [departments.orgId, departments.id],
    }),
    foreignKey({
      name: "employment_records_team_fk",
      columns: [t.orgId, t.teamId],
      foreignColumns: [teams.orgId, teams.id],
    }),
    foreignKey({
      name: "employment_records_location_fk",
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }),
    foreignKey({
      name: "employment_records_cost_centre_fk",
      columns: [t.orgId, t.costCentreId],
      foreignColumns: [costCentres.orgId, costCentres.id],
    }),
    foreignKey({
      name: "employment_records_manager_fk",
      columns: [t.orgId, t.managerEmployeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    foreignKey({
      name: "employment_records_schedule_fk",
      columns: [t.orgId, t.workScheduleId],
      foreignColumns: [workSchedules.orgId, workSchedules.id],
    }),
    index("employment_records_lookup").on(t.orgId, t.employeeId, t.effectiveFrom),
    index("employment_records_manager").on(t.orgId, t.managerEmployeeId),
  ],
);

export type PayBasis = "monthly" | "hourly";

export const compensationRecords = pgTable(
  "compensation_records",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    eventId: uuid("event_id").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    payBasis: text("pay_basis").$type<PayBasis>().notNull(),
    /** Basic monthly pay, or hourly rate, in integer cents. */
    amountCents: cents("amount_cents").notNull(),
    reason: text("reason"),
    retroactive: boolean("retroactive").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("compensation_records_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("compensation_records_employee_fk", t),
    foreignKey({
      name: "compensation_records_event_fk",
      columns: [t.orgId, t.eventId],
      foreignColumns: [lifecycleEvents.orgId, lifecycleEvents.id],
    }),
    index("compensation_records_lookup").on(t.orgId, t.employeeId, t.effectiveFrom),
  ],
);

/** Allowance type reference. The payroll change adds CPF and tax treatment columns. */
export const allowanceTypes = pgTable(
  "allowance_types",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("allowance_types_org_id_id_unique").on(t.orgId, t.id),
    uniqueIndex("allowance_types_active_code_unique")
      .on(t.orgId, sql`lower(${t.code})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export const recurringAllowances = pgTable(
  "recurring_allowances",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    allowanceTypeId: uuid("allowance_type_id").notNull(),
    eventId: uuid("event_id"),
    /** Per month, integer cents. */
    amountCents: cents("amount_cents").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("recurring_allowances_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("recurring_allowances_employee_fk", t),
    foreignKey({
      name: "recurring_allowances_type_fk",
      columns: [t.orgId, t.allowanceTypeId],
      foreignColumns: [allowanceTypes.orgId, allowanceTypes.id],
    }),
    foreignKey({
      name: "recurring_allowances_event_fk",
      columns: [t.orgId, t.eventId],
      foreignColumns: [lifecycleEvents.orgId, lifecycleEvents.id],
    }),
    index("recurring_allowances_lookup").on(t.orgId, t.employeeId, t.allowanceTypeId, t.effectiveFrom),
  ],
);

/**
 * Year-to-date figures carried over from the previous payroll system for a
 * mid-year switch, per employee and calendar year, covering January through
 * `through_month`. Payroll reads these to apply the annual AW ceiling
 * (which depends on YTD OW subject to CPF) and for IR8A. Payroll may add
 * columns; the import template is versioned.
 */
export const ytdOpeningBalances = pgTable(
  "ytd_opening_balances",
  {
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    year: smallint("year").notNull(),
    /** Last month (1-12) covered by these figures. */
    throughMonth: smallint("through_month").notNull(),
    /** Gross ordinary wages paid. */
    owCents: cents("ow_cents").notNull(),
    /** Ordinary wages subject to CPF (after the monthly OW ceiling). Null when not supplied. */
    owCpfCents: cents("ow_cpf_cents"),
    /** Gross additional wages paid (bonus, AWS, ...). */
    awCents: cents("aw_cents").notNull(),
    /** Additional wages subject to CPF (after the AW ceiling). Null when not supplied. */
    awCpfCents: cents("aw_cpf_cents"),
    cpfEeCents: cents("cpf_ee_cents").notNull(),
    cpfErCents: cents("cpf_er_cents").notNull(),
    shgCents: cents("shg_cents").notNull(),
    sdlCents: cents("sdl_cents"),
    importJobId: uuid("import_job_id"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "ytd_opening_balances_pk", columns: [t.orgId, t.employeeId, t.year] }),
    employeeFk("ytd_opening_balances_employee_fk", t),
  ],
);

export type ImportKind = "employees" | "compensation" | "ytd";
export type ImportStatus = "previewed" | "committed" | "failed";

export interface ImportCellError {
  row: number;
  column: string;
  value: string;
  message: string;
}

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    kind: text("kind").$type<ImportKind>().notNull(),
    status: text("status").$type<ImportStatus>().notNull(),
    fileName: text("file_name"),
    /** Parsed rows keyed by template column. Sensitive cells are SecretBox ciphertext. */
    rows: jsonb("rows").$type<Record<string, string>[]>().notNull(),
    errors: jsonb("errors").$type<ImportCellError[]>().notNull(),
    validRowCount: integer("valid_row_count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("import_jobs_org_id_id_unique").on(t.orgId, t.id)],
);

export type ChecklistKind = "onboarding" | "offboarding";
export type ChecklistAssigneeRole = "hr_admin" | "payroll_admin" | "manager" | "employee";

export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    kind: text("kind").$type<ChecklistKind>().notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("checklist_templates_org_id_id_unique").on(t.orgId, t.id),
    uniqueIndex("checklist_templates_one_default").on(t.orgId, t.kind).where(sql`${t.isDefault}`),
  ],
);

export const checklistTemplateItems = pgTable(
  "checklist_template_items",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    templateId: uuid("template_id").notNull(),
    title: text("title").notNull(),
    assigneeRole: text("assignee_role").$type<ChecklistAssigneeRole>().notNull(),
    /** Days relative to the start date (onboarding) or last working day (offboarding); may be negative. */
    dueOffsetDays: integer("due_offset_days").notNull(),
    position: smallint("position").notNull(),
  },
  (t) => [
    unique("checklist_template_items_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "checklist_template_items_template_fk",
      columns: [t.orgId, t.templateId],
      foreignColumns: [checklistTemplates.orgId, checklistTemplates.id],
    }).onDelete("cascade"),
  ],
);

export type ChecklistStatus = "open" | "cancelled";
export type ChecklistItemStatus = "open" | "done" | "skipped" | "cancelled";

export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    eventId: uuid("event_id").notNull(),
    templateId: uuid("template_id"),
    kind: text("kind").$type<ChecklistKind>().notNull(),
    anchorDate: date("anchor_date").notNull(),
    status: text("status").$type<ChecklistStatus>().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("checklists_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("checklists_employee_fk", t),
    foreignKey({
      name: "checklists_event_fk",
      columns: [t.orgId, t.eventId],
      foreignColumns: [lifecycleEvents.orgId, lifecycleEvents.id],
    }),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    checklistId: uuid("checklist_id").notNull(),
    title: text("title").notNull(),
    assigneeRole: text("assignee_role").$type<ChecklistAssigneeRole>().notNull(),
    dueOn: date("due_on").notNull(),
    status: text("status").$type<ChecklistItemStatus>().notNull().default("open"),
    position: smallint("position").notNull(),
    doneBy: uuid("done_by"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    skipReason: text("skip_reason"),
  },
  (t) => [
    unique("checklist_items_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "checklist_items_checklist_fk",
      columns: [t.orgId, t.checklistId],
      foreignColumns: [checklists.orgId, checklists.id],
    }).onDelete("cascade"),
    index("checklist_items_open").on(t.orgId, t.status, t.dueOn),
  ],
);

export type ChangeRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

/**
 * Employee-submitted changes to sensitive fields. `fields` holds the proposed
 * values; sensitive ones (ID number, bank account) are SecretBox ciphertext.
 */
export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
    fieldNames: text("field_names").array().notNull(),
    routeToRole: text("route_to_role").$type<"hr_admin" | "payroll_admin">().notNull(),
    attachmentFileKey: text("attachment_file_key"),
    approvalRequestId: text("approval_request_id"),
    status: text("status").$type<ChangeRequestStatus>().notNull().default("pending"),
    effectiveFrom: date("effective_from"),
    requestedBy: uuid("requested_by"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("profile_change_requests_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("profile_change_requests_employee_fk", t),
    index("profile_change_requests_pending").on(t.orgId, t.employeeId, t.status),
  ],
);

export type Employee = typeof employees.$inferSelect;
export type EmergencyContact = typeof emergencyContacts.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type WorkPass = typeof workPasses.$inferSelect;
export type Tenure = typeof tenures.$inferSelect;
export type LifecycleEvent = typeof lifecycleEvents.$inferSelect;
export type EmploymentRecord = typeof employmentRecords.$inferSelect;
export type CompensationRecord = typeof compensationRecords.$inferSelect;
export type AllowanceType = typeof allowanceTypes.$inferSelect;
export type RecurringAllowance = typeof recurringAllowances.$inferSelect;
export type YtdOpeningBalance = typeof ytdOpeningBalances.$inferSelect;
export type ImportJob = typeof importJobs.$inferSelect;
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type ChecklistTemplateItem = typeof checklistTemplateItems.$inferSelect;
export type Checklist = typeof checklists.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type ProfileChangeRequest = typeof profileChangeRequests.$inferSelect;
