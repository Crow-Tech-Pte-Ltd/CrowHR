import type * as React from "react";

/**
 * Optional slots a host build fills before the app starts. The self-hosted build leaves them
 * empty; the public demo (apps/demo) adds its outbox and persona descriptions. Nothing here
 * changes what the server allows: these are presentation hooks only.
 */
export interface ShellExtensions {
  /** Rendered in the notifications popover footer (the demo's "Demo outbox"). */
  NotificationsFooter?: React.ComponentType<{ onNavigate: () => void }>;
  /** Labels and one-line descriptions for demo personas, keyed by account email. */
  demoPersonas?: Record<string, { key?: string; label: string; blurb: string; order: number }>;
  /**
   * Demo only: where the Singpass button starts a real Singpass login (a Crow HR server's
   * `/api/v1/auth/oidc/<id>/start?purpose=demo`). Unset: the button stays disabled like the others.
   */
  demoSingpassStartUrl?: string;
  /** Shown under the persona picker (e.g. the shared demo password). */
  demoSignInNote?: string;
}

export const shellExtensions: ShellExtensions = {};
