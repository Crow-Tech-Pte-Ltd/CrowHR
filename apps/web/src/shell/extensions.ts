/**
 * Optional slots a host build fills before the app starts. The self-hosted build leaves them
 * empty; the public demo (apps/demo) adds its outbox and persona descriptions. Nothing here
 * changes what the server allows: these are presentation hooks only.
 */
export interface ShellExtensions {
  /** Opens the test email capture panel from a demo password reset. */
  openDemoEmails?: () => void;
  /** Labels and one-line descriptions for demo personas, keyed by account email. */
  demoPersonas?: Record<string, { key?: string; label: string; blurb: string; order: number }>;
  /**
   * Demo only: where the Singpass button starts a real Singpass login (a Crow HR server's
   * `/api/v1/auth/oidc/<id>/start?purpose=demo`). Unset: the button stays disabled like the others.
   */
  demoSingpassStartUrl?: string;
  /** Shared password shown under the public demo persona picker. */
  demoPassword?: string;
}

export const shellExtensions: ShellExtensions = {};
