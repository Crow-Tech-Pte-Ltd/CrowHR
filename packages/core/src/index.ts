export { authorize, can, type Grant } from "./access/authorize.ts";
export { ASSIGNED_ROLES, MATRIX, type MatrixRow, PERMISSIONS, type Permission, type Scope } from "./access/matrix.ts";
export { markMembershipFormer } from "./access/members-routes.ts";
export { maskBankAccount, maskNric, revealSensitive } from "./access/nric.ts";
export { type OrgScope, orgScope } from "./access/org-scope.ts";
export { redact, redactMany, withRedactions } from "./access/redact.ts";
export { createStaticReportingScope, noReportingLines, type ReportingScopeResolver } from "./access/scope.ts";
export { assertNotSelfChange, selfApproval } from "./access/self-change.ts";
export { type SensitivityClass, sensitive } from "./access/sensitivity.ts";
export { type App, allV1Modules, createApp, V1_MODULES } from "./app.ts";
export {
  type AuditContext,
  auditContext,
  diffFields,
  recordAudit,
  systemAuditContext,
  verifyChain,
} from "./audit/audit.ts";
export { requireRecentAuth } from "./auth/guards.ts";
export { newResetLinkForCli } from "./auth/owner-recovery.ts";
export { passwordProblem } from "./auth/password-policy.ts";
export { revokeUserSessions } from "./auth/sessions.ts";
export type { ClientInfo } from "./context.ts";
export {
  type AppContext,
  type AppEnv,
  type AppVariables,
  type AssignedRole,
  type AuthContext,
  type AuthMethod,
  type Role,
  requireAuth,
} from "./context.ts";
export {
  createSecretBox,
  generateSecretKey,
  normaliseBankAccount,
  normaliseNric,
  parseSecretKey,
  SECRET_PURPOSES,
  type SecretBox,
  SecretBoxError,
  verifySecretKeyAgainstDb,
} from "./crypto/secret-box.ts";
export * as schema from "./db/schema/index.ts";
export type { Db, Schema } from "./db/types.ts";
export {
  type AppDeps,
  type Clock,
  fixedClock,
  type IdGenerator,
  type Mailer,
  type PasswordHasher,
  systemClock,
} from "./deps.ts";
export type * from "./employees/public-types.ts";
export { createReportingScopeResolver } from "./employees/reports/reporting-scope.ts";
export { AppError, ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from "./errors.ts";
export {
  assertValidFileKey,
  type FileStore,
  InvalidFileKeyError,
  type StoredFile,
  type StoredFileWithData,
} from "./files/file-store.ts";
export { createMemoryFileStore } from "./files/memory-file-store.ts";
export { csvEnum, listQuery, orderByFor, type Page, pageOf, parseSort, toLimitOffset } from "./http/list.ts";
export { type ApiModule, defineModule, defineRoute, reply } from "./http/route.ts";
export { friendlyIssueMessage, toValidationIssues, type ValidationIssue, validate } from "./http/validate.ts";
export { createUuidV7Generator } from "./ids.ts";
export { createManualScheduler, type ManualScheduler, type Scheduler } from "./jobs/scheduler.ts";
export { type TickReport, tick } from "./jobs/tick.ts";
export {
  createJsonConsoleLogger,
  createMemoryLogger,
  type LogEntry,
  type LogFields,
  type Logger,
  type LogLevel,
  noopLogger,
} from "./logger.ts";
export type { HealthResponse } from "./modules/health/routes.ts";
export { type EmailPayload, renderEmail } from "./notifications/email-templates.ts";
export { NOTIFICATION_KINDS, type NotificationKind } from "./notifications/kinds.ts";
export { type NotifyInput, notify } from "./notifications/notify.ts";
export {
  formatSetupCode,
  generateSetupCode,
  hashSetupCode,
  normaliseSetupCode,
  SETUP_CODE_ALPHABET,
} from "./setup/code.ts";
export { SETUP_CODE_HEADER } from "./setup/routes.ts";
export { isSetupRequired, storeSetupCode } from "./setup/service.ts";
export type { DiskUsage, SystemHost, SystemHostInfo } from "./system/host.ts";
export {
  deleteSystemSetting,
  getSystemSetting,
  lastBackupRuns,
  type SchemaVersion,
  SYSTEM_KEYS,
  setSystemSetting,
} from "./system/settings.ts";
export { BACKUP_STALE_HOURS, type SystemStatus } from "./system/status.ts";
export { VERSION } from "./version.ts";
export { createApproverDirectory } from "./workflows/directory.ts";
export {
  decideTask,
  onReportingLineChanged,
  type SubmitInput,
  type SubmitResult,
  submitApproval,
  withdrawSubject,
} from "./workflows/engine.ts";
export { CORE_WORKFLOW_PLUGINS } from "./workflows/registry.ts";
export type {
  ApproverDirectory,
  ApproverRule,
  DirectoryMember,
  DueReminder,
  FinalDecision,
  InboxItem,
  InboxSource,
  ManagerResolver,
  PeopleDates,
  ProbationEnd,
  ReminderSource,
  SubjectAdapter,
  SubjectAttributes,
  SubjectRef,
  SubjectSummary,
  Transition,
  WorkflowPlugin,
  WorkPassExpiry,
} from "./workflows/types.ts";
