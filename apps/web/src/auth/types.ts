/** Wire shapes of the identity endpoints (mirrors packages/core response schemas). */
export type ProviderKind = "google" | "entra" | "singpass" | "oidc";
export type AssignedRole = "owner" | "hr_admin" | "payroll_admin";

export interface Me {
  /** Greet with `greetingName(user)`: preferred name, else full name. Never split a name into first/last. */
  user: { id: string; email: string; displayName: string; preferredName: string | null; fullName: string };
  organisation: { id: string; name: string; slug: string | null };
  membershipId: string;
  membershipStatus: "active" | "former";
  employeeId: string | null;
  roles: ("owner" | "hr_admin" | "payroll_admin" | "manager" | "employee")[];
  permissions: Record<string, ("all" | "team" | "own" | "assigned")[]>;
  authMethod: string;
  session: { kind: "browser" | "device"; authenticatedAt: string };
  mfa: {
    enrolled: boolean;
    required: boolean;
    graceEndsAt: string | null;
    blocked: boolean;
    remainingRecoveryCodes: number;
  };
  hasPassword: boolean;
  insecureTransport: boolean;
  demoMode: boolean;
  mailerConfigured: boolean;
}

export interface SignInMethods {
  orgSlugRequired: boolean;
  organisation: { name: string; slug: string | null } | null;
  password: { enabled: boolean };
  providers: { id: string; kind: ProviderKind; displayName: string; allowedDomains: string[] }[];
  demoMode: boolean;
}

export interface SignInResult {
  mfaRequired: boolean;
  mfaToken?: string;
  mfaExpiresAt?: string;
  redirectTo?: string;
}

export interface SessionItem {
  id: string;
  kind: "browser" | "mobile";
  device: string;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
  authMethod: string;
  appVersion?: string | null;
}

export interface Member {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  /** The linked employee's preferred name, if any. */
  preferredName: string | null;
  status: "invited" | "active" | "suspended" | "former";
  roles: AssignedRole[];
  employeeId: string | null;
  mfaEnrolled: boolean;
  lockedUntil: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  invitation: { id: string; expiresAt: string; expired: boolean } | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Provider {
  id: string;
  kind: ProviderKind;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  privateKeysSet: boolean;
  tenantId: string | null;
  allowedDomains: string[];
  environment: "staging" | "production" | null;
  jitEnabled: boolean;
  enabled: boolean;
  configured: boolean;
  lastTestOkAt: string | null;
  callbackUrl: string;
  jwksUrl: string | null;
}

export interface SecuritySettings {
  passwordEnabled: boolean;
  mfaRequiredRoles: AssignedRole[];
  idleTimeoutMin: number;
  absoluteTimeoutH: number;
  deviceIdleDays: number;
  insecureTransport: boolean;
  emailConfigured: boolean;
  demoMode: boolean;
  providers: Provider[];
}

export interface AuditEvent {
  id: string;
  seq: number;
  at: string;
  actorType: "member" | "system" | "cli" | "anonymous";
  actorMembershipId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  /** Member/employee/department name when it still exists; null otherwise. */
  targetLabel: string | null;
  ip: string | null;
  diff: unknown;
  meta: unknown;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  hr_admin: "HR admin",
  payroll_admin: "Payroll admin",
  manager: "Manager",
  employee: "Employee",
};

export const PROVIDER_LABEL: Record<ProviderKind, string> = {
  google: "Google Workspace",
  entra: "Microsoft Entra ID",
  singpass: "Singpass",
  oidc: "OpenID Connect",
};
