import {
  type AppDeps,
  createUuidV7Generator,
  endAllDemoCompanies,
  newResetLinkForCli,
  purgeExpiredDemoCompanies,
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

/**
 * `crowhr demo-companies purge [--expired]` (add-demo-companies rollback): deletes every demo
 * company, live ones included, or only the expired ones. Real organisations (no demo expiry) are
 * never selected, and the database refuses to delete their audit events anyway.
 */
export async function demoCompaniesPurgeCommand(
  deps: Pick<AppDeps, "db" | "fileStore" | "logger">,
  input: { expiredOnly: boolean },
): Promise<{ ok: boolean; lines: string[] }> {
  const now = new Date();
  const n = input.expiredOnly ? await purgeExpiredDemoCompanies(deps, now) : await endAllDemoCompanies(deps, now);
  const what = `${n} ${input.expiredOnly ? "expired " : ""}demo compan${n === 1 ? "y" : "ies"}`;
  return { ok: true, lines: [`Deleted ${what}. Real organisations were not touched.`] };
}

export function cliDeps(db: Database["db"], publicUrl: string) {
  return { db, publicUrl, clock: systemClock, ids: createUuidV7Generator(systemClock) };
}
