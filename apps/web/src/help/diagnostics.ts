import type { SystemStatus } from "@crowhr/core";

/** The API uses generated UUIDs for request IDs. Reserved sentinels have no log correlation. */
export function requestReference(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}

type SystemFacts = Pick<SystemStatus, "database" | "backups" | "request">;

/** Fixed labels only. System status also contains private paths, addresses and raw backup errors. */
export function systemChecks(s: SystemFacts): string[] {
  return [
    s.database.status === "ok" ? "Database reachable" : "Database unreachable",
    s.backups.stale ? "Backup needs attention" : "Backup is recent",
    s.request.scheme === "https" ? "Server recognised HTTPS" : "Server recognised HTTP",
  ];
}

export function diagnostics(facts: {
  topic: string;
  version?: string;
  time?: string;
  reference?: string;
  system?: SystemFacts;
}): string {
  const lines = [`Area: ${facts.topic}`];
  if (facts.version && /^[0-9][0-9A-Za-z.+-]{0,39}$/.test(facts.version)) lines.push(`Version: ${facts.version}`);
  if (facts.time && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(facts.time)) lines.push(`Checked at: ${facts.time}`);
  const reference = requestReference(facts.reference);
  if (reference) lines.push(`Request reference: ${reference}`);
  if (facts.system) lines.push(...systemChecks(facts.system));
  return lines.join("\n");
}

export function supportEmail(summary: string): string {
  const body = `What were you trying to do?\n\nWhat happened?\n\nWhat did you expect?\n\nTechnical summary\n${summary}\n`;
  return `mailto:hello@crowhr.com?subject=${encodeURIComponent("[Crow HR] Support")}&body=${encodeURIComponent(body)}`;
}
