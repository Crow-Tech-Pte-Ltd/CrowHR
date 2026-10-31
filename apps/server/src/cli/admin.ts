import {
  type AppDeps,
  createUuidV7Generator,
  newResetLinkForCli,
  schema,
  systemAuditContext,
  systemClock,
  verifyChain,
} from "@crowhr/core";
import { eq } from "drizzle-orm";
import type { Database } from "../db.ts";

/**
 * `crowhr admin …` commands (run inside the app container). They talk to the database directly
 * with the same core services, and every change is audited with actor type `cli`.
 */

export async function verifyAuditCommand(
  db: Database["db"],
  orgSlug?: string,
): Promise<{ ok: boolean; lines: string[] }> {
  const orgs = await db.select().from(schema.organisations);
  const selected = orgSlug ? orgs.filter((o) => o.slug === orgSlug) : orgs;
  if (orgSlug && !selected.length) return { ok: false, lines: [`No organisation with slug "${orgSlug}".`] };
  const lines: string[] = [];
  let ok = true;
  for (const org of selected) {
    const result = await verifyChain(db, org.id);
    if (result.ok) lines.push(`${org.slug ?? org.id}: OK, ${result.count} events, chain intact.`);
    else {
      ok = false;
      lines.push(
        `${org.slug ?? org.id}: BROKEN at event ${result.brokenEventId} (seq ${result.seq}, ${result.reason.replace("_", " ")}). Events from here on cannot be trusted; restore from a backup and investigate.`,
      );
    }
  }
  return { ok, lines };
}

/**
 * Last-resort owner recovery: prints a one-time password reset link (60 minutes) and, with
 * `resetMfa`, clears the owner's two-step verification. No password is ever typed into the shell.
 */
export async function resetOwnerPasswordCommand(
  deps: Pick<AppDeps, "db" | "publicUrl" | "clock" | "ids">,
  input: { orgSlug: string; email: string; resetMfa: boolean },
): Promise<{ ok: boolean; lines: string[] }> {
  const [org] = await deps.db.select().from(schema.organisations).where(eq(schema.organisations.slug, input.orgSlug));
  if (!org)
    return { ok: false, lines: [`No organisation with slug "${input.orgSlug}". List them with: crowhr admin orgs`] };
  const result = await newResetLinkForCli(deps, {
    orgId: org.id,
    email: input.email,
    resetMfa: input.resetMfa,
    ctx: systemAuditContext(org.id, "cli", "crowhr admin reset-owner-password"),
  });
  if (!result.ok) return { ok: false, lines: [result.message] };
  return {
    ok: true,
    lines: [
      `Reset link for ${input.email} (valid 60 minutes, single use):`,
      result.url,
      ...(input.resetMfa
        ? ["Two-step verification was cleared; the owner must set it up again after signing in."]
        : []),
    ],
  };
}

export function cliDeps(db: Database["db"], publicUrl: string) {
  return { db, publicUrl, clock: systemClock, ids: createUuidV7Generator(systemClock) };
}
