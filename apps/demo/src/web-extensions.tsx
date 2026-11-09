import { DEMO_PASSWORD, PERSONAS } from "@crowhr/demo/personas";
import { Mail } from "lucide-react";
import { shellExtensions } from "../../web/src/shell/extensions.ts";

export const OPEN_OUTBOX = "crowhr-demo:open-outbox";

export function openOutbox() {
  window.dispatchEvent(new CustomEvent(OPEN_OUTBOX));
}

function OutboxFooterLink({ onNavigate }: { onNavigate: () => void }) {
  return (
    <button
      type="button"
      data-testid="demo-outbox-link"
      onClick={() => {
        onNavigate();
        openOutbox();
      }}
      className="focus-ring inline-flex items-center gap-1 rounded-sm text-2xs font-medium text-biru-400 hover:underline"
    >
      <Mail className="size-3.5" aria-hidden />
      Demo outbox
    </button>
  );
}

/** Fills apps/web's presentation slots before its entry runs (see apps/web/src/shell/extensions.ts). */
export function configureWebForDemo() {
  shellExtensions.NotificationsFooter = OutboxFooterLink;
  shellExtensions.demoPersonas = Object.fromEntries(
    PERSONAS.map((p, i) => [p.email, { key: p.key, label: p.label, blurb: p.blurb, order: i }]),
  );
  // Build-time: a Crow HR server's demo Singpass start URL (see the Singpass guide). Unset: disabled.
  const singpassStart = import.meta.env.VITE_DEMO_SINGPASS_START_URL;
  if (singpassStart) shellExtensions.demoSingpassStartUrl = singpassStart;
  shellExtensions.demoSignInNote = `Prefer typing? Every demo account's password is ${DEMO_PASSWORD}. Emails the app would send appear in the Demo outbox.`;
}
