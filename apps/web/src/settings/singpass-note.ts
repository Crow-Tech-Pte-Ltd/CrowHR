/** What Settings → Security says under a Singpass method about where its testing stands. */
export interface SingpassNote {
  tone: "warning" | "info";
  text: string;
}

export function singpassNote(p: {
  configured: boolean;
  environment: "staging" | "production" | null;
  lastTestOkAt: string | null;
}): SingpassNote | null {
  // Without a client ID the row already shows the setup steps.
  if (!p.configured) return null;
  if (p.environment === "production") {
    return p.lastTestOkAt ? null : { tone: "warning", text: "Production: run Test sign-in before turning it on." };
  }
  if (!p.lastTestOkAt) {
    return {
      tone: "warning",
      text: "Not tested yet. Run Test sign-in with a Singpass staging test account (Developer Portal → Test account).",
    };
  }
  return {
    tone: "info",
    text: "Staging test passed. For production, switch to Production with the production client ID and test again.",
  };
}
