import { eq } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { assistantGrants, orgAssistantSettings } from "../db/schema/assistant.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";

export const ASSISTANT_SCOPE = "crowhr:self_service";
export const ASSISTANT_DISABLED = "AI assistants are disabled on this server.";

export function assistantAvailable(deps: AppDeps) {
  return (
    deps.assistantEnabled === true &&
    deps.publicUrl.startsWith("https://") &&
    !deps.demoMode &&
    !deps.demoCompanies &&
    !deps.demoSingpass
  );
}

export function assistantResource(deps: AppDeps, slug: string) {
  return new URL(`/mcp/${encodeURIComponent(slug)}`, deps.publicUrl).href;
}

export async function assistantOrg(deps: AppDeps, slug: string) {
  if (!assistantAvailable(deps) || !/^[a-z0-9-]{1,100}$/.test(slug)) return null;
  const [org] = await deps.db.select().from(organisations).where(eq(organisations.slug, slug));
  if (!org?.slug || org.demoExpiresAt || !(await isAssistantEnabled(deps.db, org.id))) return null;
  return org;
}

export async function isAssistantEnabled(db: Db, orgId: string, lock = false) {
  const org = orgScope(db, orgId);
  const query = db
    .select({ enabled: orgAssistantSettings.enabled })
    .from(orgAssistantSettings)
    .where(org.where(orgAssistantSettings));
  const [row] = lock ? await query.for("update") : await query;
  return row?.enabled ?? false;
}

export async function setAssistantEnabled(deps: AppDeps, db: Db, ctx: AuditContext, enabled: boolean) {
  if (!assistantAvailable(deps)) throw new AppError("forbidden", ASSISTANT_DISABLED);
  const org = orgScope(db, ctx.orgId);
  await db
    .insert(orgAssistantSettings)
    .values(org.values({ enabled }))
    .onConflictDoUpdate({ target: orgAssistantSettings.orgId, set: { enabled } });
  if (!enabled) await db.delete(assistantGrants).where(org.where(assistantGrants));
  await recordAudit(db, deps, ctx, {
    action: "assistant.settings_updated",
    targetType: "organisation",
    targetId: org.orgId,
    meta: { enabled },
  });
}
