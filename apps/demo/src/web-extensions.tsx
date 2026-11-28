import { DEMO_PASSWORD, PERSONAS } from "@crowhr/demo/personas";
import { shellExtensions } from "../../web/src/shell/extensions.ts";

export const OPEN_OUTBOX = "crowhr-demo:open-outbox";

export function openOutbox() {
  window.dispatchEvent(new CustomEvent(OPEN_OUTBOX));
}

/** Fills apps/web's presentation slots before its entry runs (see apps/web/src/shell/extensions.ts). */
export function configureWebForDemo() {
  shellExtensions.openDemoEmails = openOutbox;
  shellExtensions.demoPersonas = Object.fromEntries(
    PERSONAS.map((p, i) => [p.email, { key: p.key, label: p.label, blurb: p.blurb, order: i }]),
  );
  // Build-time: a Crow HR server's demo Singpass start URL (see the Singpass guide). Unset: disabled.
  const singpassStart = import.meta.env.VITE_DEMO_SINGPASS_START_URL;
  if (singpassStart) shellExtensions.demoSingpassStartUrl = singpassStart;
  shellExtensions.demoPassword = DEMO_PASSWORD;
}
