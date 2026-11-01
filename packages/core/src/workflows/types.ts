import type { z } from "zod";
import type { AssignedRole } from "../access/matrix.ts";
import type { AuditContext } from "../audit/audit.ts";
import type { SubjectAttributes } from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";

/**
 * Integration contracts of the approval engine (design.md decisions 1, 6, 7).
 *
 * Every function that touches the database receives `db` explicitly: inside the engine that is
 * the decision's transaction, so adapter callbacks and directory lookups commit (or roll back)
 * with the decision, and single-connection drivers (PGlite in tests and the browser demo) never
 * wait on themselves.
 */

/** The subject types named by the spec. Plugins may register more (lower snake case). */
export const KNOWN_SUBJECT_TYPES = [
  "leave",
  "leave_cancellation",
  "claim",
  "overtime",
  "timesheet",
  "profile_change",
  "shift_swap",
  "payroll_run",
] as const;
export type KnownSubjectType = (typeof KNOWN_SUBJECT_TYPES)[number];

export type { SubjectAttributes };

/** What the engine hands a module about one of its subjects. */
export interface SubjectRef {
  orgId: string;
  subjectType: string;
  subjectId: string;
  requestId: string;
  requesterMembershipId: string;
  requesterEmployeeId: string | null;
  attributes: SubjectAttributes;
  /** Members who may not decide besides the requester (on-behalf filer, beneficiaries). */
  excludedDeciderMembershipIds?: readonly string[];
}

export interface FinalDecision {
  outcome: "approved" | "rejected";
  /** The member who made the final decision. */
  decidedByMembershipId: string;
  /** Set when the decider acted as a delegate. */
  onBehalfOfMembershipId: string | null;
  comment: string | null;
  selfApproved: boolean;
  decidedAt: Date;
}

/** Shown to approvers. Keep `title` free of money and IDs: it appears in notification titles. */
export interface SubjectSummary {
  title: string;
  /** e.g. `{ label: "Dates", value: "4–6 Nov 2026" }`. */
  lines: { label: string; value: string }[];
  /** Requester context the module provides, e.g. remaining balance or monthly cap. */
  context: { label: string; value: string }[];
}

/** Read check for one subject. `viewer` is the member asking; the engine adds task holders itself. */
export interface ReadContext {
  orgId: string;
  membershipId: string;
  employeeId: string | null;
  roles: readonly AssignedRole[];
  /** False for a former member signed in to read their own payslips: they see only their own requests. */
  active?: boolean;
}

/**
 * The plugin contract a module implements for each request type it submits (leave, claim,
 * overtime, timesheet, profile_change, shift_swap, payroll_run, …). Callbacks run inside the
 * decision's transaction: do local DB work only (no outbound HTTP), and throw `AppError` to refuse
 * the decision; the engine then rolls everything back and the approver sees your message.
 */
export interface SubjectAdapter<A extends SubjectAttributes = SubjectAttributes> {
  type: string;
  /** Human label, e.g. "Leave", "Claim", "Payroll run". */
  label: string;
  /** Validates the declared attributes at submission (e.g. `z.object({ amountCents: z.int().min(1) })`). */
  attributes?: z.ZodType<A>;
  /** Extra checks at submission, in the caller's transaction. Throw `AppError` to refuse. */
  validate?(db: Db, ref: SubjectRef & { attributes: A }): Promise<void>;
  summary(db: Db, ref: SubjectRef & { attributes: A }): Promise<SubjectSummary>;
  onApproved(db: Db, ref: SubjectRef & { attributes: A }, decision: FinalDecision): Promise<void>;
  onRejected(db: Db, ref: SubjectRef & { attributes: A }, decision: FinalDecision): Promise<void>;
  onWithdrawn?(db: Db, ref: SubjectRef & { attributes: A }): Promise<void>;
  /** Whether a member who is not the requester or a task holder may read the subject. Default: no. */
  canRead?(db: Db, viewer: ReadContext, ref: SubjectRef & { attributes: A }): Promise<boolean>;
  /**
   * Whether this member may decide this subject at all (role, segregation of duties), on top of the
   * engine's own rules (active member, not the requester or an excluded decider, holds the task's
   * role, payroll runs only by owners). The engine asks it before it resolves, escalates,
   * delegates or reassigns a task to someone, and again on every decision (single, bulk, inline,
   * delegated), so a member it refuses never sees a task and can never decide one. Default: yes.
   */
  canDecide?(db: Db, decider: DirectoryMember, ref: SubjectRef & { attributes: A }): Promise<boolean>;
  /** In-app link to the subject, e.g. `/leave/<id>`. Defaults to the inbox detail. */
  link?(ref: SubjectRef): string;
  /** Leave, claim and profile-change tasks are decided inline on Home (spec "Home work-to-do inbox"). */
  inlineDecision?: boolean;
  /** Overrides the built-in default chain for this type. */
  defaultSteps?: readonly PolicyStepInput[];
  /** Only owners may configure the policy (payroll). */
  ownerOnlyPolicy?: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: adapters are stored erased and re-typed by `type`.
export type AnySubjectAdapter = SubjectAdapter<any>;

export type ApproverRule =
  | "manager"
  | "manager_of_manager"
  | "role:owner"
  | "role:hr_admin"
  | "role:payroll_admin"
  | `member:${string}`;

export interface PolicyStepInput {
  approverRule: ApproverRule;
  escalateAfterDays: number;
}

/** A member as the engine needs to know them. */
export interface DirectoryMember {
  membershipId: string;
  employeeId: string | null;
  displayName: string;
  email: string;
  status: "invited" | "active" | "suspended" | "former";
  roles: readonly AssignedRole[];
}

/**
 * Who can approve. `managerOf` is implemented by the people module (reporting lines); the member
 * lookups have a default built on memberships (`createApproverDirectory`). Test double:
 * `createApproverDirectory({ managers: { [employeeId]: managerEmployeeId } })`.
 */
export interface ApproverDirectory {
  /** The employee's current line manager's employee ID as at `onDate` (YYYY-MM-DD, SGT), or null. */
  managerOf(db: Db, orgId: string, employeeId: string, onDate: string): Promise<string | null>;
  /** Members (any status) holding an assigned role. The engine filters to active. */
  membersWithRole(db: Db, orgId: string, role: AssignedRole): Promise<readonly DirectoryMember[]>;
  memberForEmployee(db: Db, orgId: string, employeeId: string): Promise<DirectoryMember | null>;
  member(db: Db, orgId: string, membershipId: string): Promise<DirectoryMember | null>;
}

/** Narrow resolver the people module supplies for `managerOf`. */
export interface ManagerResolver {
  managerOf(db: Db, orgId: string, employeeId: string, onDate: string): Promise<string | null>;
}

/** One actionable item on Home (design decision 7). */
export interface InboxItem {
  id: string;
  source: string;
  /** e.g. `approval`, `work_pass_expiry`, `probation_end`, `payroll_due`, `setup`. */
  kind: string;
  title: string;
  /** Who it concerns, e.g. the requester or the pass holder. */
  concerns: string | null;
  detail: string | null;
  /** YYYY-MM-DD (SGT) or null. */
  dueOn: string | null;
  createdAt: string;
  href: string;
  actionLabel: string;
  /** Present for approval tasks that may be decided inline. */
  task: {
    id: string;
    requestId: string;
    subjectType: string;
    inline: boolean;
    origin: "resolved" | "delegated" | "escalated" | "reassigned";
    onBehalfOf: string | null;
  } | null;
}

export interface InboxContext extends ReadContext {
  /** Today in Asia/Singapore (YYYY-MM-DD). */
  today: string;
  now: Date;
  /** True when the member is the line manager of at least one employee. */
  isManager: boolean;
}

/** A source of Home items (checklists, setup steps, payroll due, …). */
export interface InboxSource {
  id: string;
  label: string;
  /** `not_set_up` lets Home say "not set up yet" instead of showing an empty list as if all were done. */
  status(db: Db, ctx: InboxContext): Promise<"ready" | "not_set_up">;
  list(db: Db, ctx: InboxContext): Promise<InboxItem[]>;
}

/** One reminder due (design decision 6). The sweep de-duplicates on (source, subjectKey, threshold). */
export interface DueReminder {
  orgId: string;
  subjectKey: string;
  threshold: string;
  dueOn: string;
  recipients: readonly string[];
  kind: string;
  title: string;
  link: string;
  /** Who it concerns, for the email ("Ravi Kumar"). Never an ID, amount or NRIC. */
  concerns: string | null;
}

export interface ReminderSource {
  id: string;
  /** Reminders whose threshold date is on or before `today` and whose condition is still unresolved. */
  due(db: Db, input: { today: string; now: Date }): Promise<DueReminder[]>;
}

/** Date-triggered transitions registered by modules (e.g. membership becomes `former`). */
export interface Transition {
  id: string;
  run(db: Db, input: { now: Date; audit: (orgId: string) => AuditContext }): Promise<number>;
}

/**
 * A module's contribution to workflows. Core modules add theirs to `CORE_WORKFLOW_PLUGINS`
 * (workflows/registry.ts); hosts and tests pass extra plugins as `deps.workflowPlugins`.
 */
export interface WorkflowPlugin {
  name: string;
  subjects?: readonly AnySubjectAdapter[];
  inbox?: readonly InboxSource[];
  reminders?: readonly ReminderSource[];
  transitions?: readonly Transition[];
}

/** People data reminders read (work passes, probation). Implemented by the people module. */
export interface PeopleDates {
  /** Current (not renewed or cancelled) passes of current employees expiring on or before `until`, any org. */
  workPassesExpiring(db: Db, range: { today: string; until: string }): Promise<WorkPassExpiry[]>;
  /** Current employees whose probation ends on or before `until` and is not yet confirmed. */
  probationsEnding(db: Db, range: { today: string; until: string }): Promise<ProbationEnd[]>;
}

export interface WorkPassExpiry {
  orgId: string;
  passId: string;
  employeeId: string;
  employeeName: string;
  passType: string;
  expiresOn: string;
}

export interface ProbationEnd {
  orgId: string;
  employeeId: string;
  employeeName: string;
  endsOn: string;
}
