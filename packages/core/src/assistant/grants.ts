import { eq, gt, lte, or } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { auditContext, recordAudit } from "../audit/audit.ts";
import { mfaPolicyStatus } from "../auth/mfa-policy.ts";
import { loadMember } from "../auth/sessions.ts";
import { DAY, loadSecuritySettings, MINUTE } from "../auth/settings.ts";
import type { AppContext, AuthContext, AuthMethod } from "../context.ts";
import { newToken, sha256Base64Url, sha256Hex } from "../crypto/tokens.ts";
import { assistantGrants } from "../db/schema/assistant.ts";
import { users } from "../db/schema/users.ts";
import { assistantProvider } from "./clients.ts";
import { ASSISTANT_SCOPE, isAssistantEnabled } from "./settings.ts";

export interface AuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  resource: string;
  code_challenge: string;
}

type Grant = typeof assistantGrants.$inferSelect;
const ACCESS_MS = 15 * MINUTE;
const GRANT_MS = 30 * DAY;
const CODE_MS = 5 * MINUTE;
const AUTH_METHODS: readonly string[] = ["password", "google", "entra", "singpass", "oidc"];

export async function policyAllows(c: AppContext, auth: AuthContext) {
  const { db, clock } = c.var.deps;
  const policy = await mfaPolicyStatus(db, auth, await loadSecuritySettings(db, auth.orgId), clock.now());
  return !policy.blocked && (!policy.enrolled || auth.session.mfaSatisfied);
}

export async function issueCode(c: AppContext, auth: AuthContext, input: AuthorizationRequest) {
  const deps = c.var.deps;
  const now = deps.clock.now();
  const code = newToken();
  const hash = await sha256Hex(code);
  return deps.db.transaction(async (tx) => {
    if (!(await isAssistantEnabled(tx, auth.orgId, true))) return null;
    const org = orgScope(tx, auth);
    await tx
      .delete(assistantGrants)
      .where(
        org.where(
          assistantGrants,
          eq(assistantGrants.membershipId, auth.membershipId),
          lte(assistantGrants.expiresAt, now),
        ),
      );
    await tx.insert(assistantGrants).values(
      org.values({
        id: deps.ids.newId(),
        membershipId: auth.membershipId,
        clientId: input.client_id,
        resource: input.resource,
        redirectUri: input.redirect_uri,
        challenge: input.code_challenge,
        codeHash: hash,
        expiresAt: new Date(now.getTime() + CODE_MS),
        authenticatedAt: auth.session.authenticatedAt,
        authMethod: auth.authMethod,
        mfaSatisfied: auth.session.mfaSatisfied,
      }),
    );
    return code;
  });
}

async function currentMember(c: AppContext, grant: Grant): Promise<AuthContext | null> {
  const { db } = c.var.deps;
  const member = await loadMember(db, grant.membershipId);
  if (
    !member ||
    member.demo ||
    member.status !== "active" ||
    member.orgId !== grant.orgId ||
    !AUTH_METHODS.includes(grant.authMethod)
  )
    return null;
  const [user] = await db
    .select({ passwordChangedAt: users.passwordChangedAt })
    .from(users)
    .where(eq(users.id, member.user.id));
  if (user?.passwordChangedAt && user.passwordChangedAt > grant.authenticatedAt) return null;
  const auth: AuthContext = {
    user: member.user,
    orgId: member.orgId,
    membershipId: grant.membershipId,
    membershipStatus: "active",
    employeeId: member.employeeId,
    roles: member.roles,
    authMethod: grant.authMethod as AuthMethod,
    identity: null,
    session: { id: grant.id, kind: "device", authenticatedAt: grant.authenticatedAt, mfaSatisfied: grant.mfaSatisfied },
  };
  return (await policyAllows(c, auth)) ? auth : null;
}

export async function authenticateAssistant(c: AppContext, orgId: string, resource: string) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(c.req.header("authorization") ?? "")?.[1];
  if (!token) return null;
  const { db, clock } = c.var.deps;
  const org = orgScope(db, orgId);
  const now = clock.now();
  const [grant] = await db
    .select()
    .from(assistantGrants)
    .where(
      org.where(
        assistantGrants,
        eq(assistantGrants.accessHash, await sha256Hex(token)),
        eq(assistantGrants.resource, resource),
        gt(assistantGrants.accessExpiresAt, now),
        gt(assistantGrants.expiresAt, now),
      ),
    );
  return grant ? currentMember(c, grant) : null;
}

export type TokenExchange =
  | {
      grant_type: "authorization_code";
      code: string;
      code_verifier: string;
      redirect_uri: string;
      client_id: string;
      resource: string;
    }
  | { grant_type: "refresh_token"; refresh_token: string; client_id: string; resource: string };

export async function exchangeToken(c: AppContext, orgId: string, input: TokenExchange) {
  const deps = c.var.deps;
  const { db, clock } = deps;
  const now = clock.now();
  const source = input.grant_type === "authorization_code" ? input.code : input.refresh_token;
  const hash = await sha256Hex(source);
  const condition =
    input.grant_type === "authorization_code"
      ? eq(assistantGrants.codeHash, hash)
      : or(eq(assistantGrants.refreshHash, hash), eq(assistantGrants.priorRefreshHash, hash));
  const org = orgScope(db, orgId);
  const [grant] = await db
    .select()
    .from(assistantGrants)
    .where(
      org.where(
        assistantGrants,
        condition,
        eq(assistantGrants.clientId, input.client_id),
        eq(assistantGrants.resource, input.resource),
        gt(assistantGrants.expiresAt, now),
      ),
    );
  if (!grant) return null;
  if (
    input.grant_type === "authorization_code" &&
    (grant.redirectUri !== input.redirect_uri || grant.challenge !== (await sha256Base64Url(input.code_verifier)))
  )
    return null;
  const auth = await currentMember(c, grant);
  if (!auth) return null;
  const access = newToken();
  const refresh = newToken();
  const accessHash = await sha256Hex(access);
  const refreshHash = await sha256Hex(refresh);
  const expiresAt = grant.connectedAt ? grant.expiresAt : new Date(now.getTime() + GRANT_MS);
  c.set("auth", auth);
  return db.transaction(async (tx) => {
    if (!(await isAssistantEnabled(tx, orgId, true))) return null;
    // Compare-and-swap makes an authorization code and each refresh credential single use.
    const [updated] = await tx
      .update(assistantGrants)
      .set({
        codeHash: null,
        accessHash,
        accessExpiresAt: new Date(now.getTime() + ACCESS_MS),
        refreshHash,
        priorRefreshHash: input.grant_type === "refresh_token" ? hash : null,
        connectedAt: grant.connectedAt ?? now,
        expiresAt,
      })
      .where(
        org.where(
          assistantGrants,
          eq(assistantGrants.id, grant.id),
          input.grant_type === "authorization_code"
            ? eq(assistantGrants.codeHash, hash)
            : eq(assistantGrants.refreshHash, hash),
        ),
      )
      .returning({ id: assistantGrants.id });
    if (!updated) {
      // A replay of the immediately prior refresh credential invalidates its connection.
      if (input.grant_type === "refresh_token") {
        const [deleted] = await tx
          .delete(assistantGrants)
          .where(
            org.where(assistantGrants, eq(assistantGrants.id, grant.id), eq(assistantGrants.priorRefreshHash, hash)),
          )
          .returning({ id: assistantGrants.id });
        if (deleted)
          await recordAudit(tx, deps, auditContext(c), {
            action: "assistant.disconnected",
            targetType: "assistant_connection",
            targetId: deleted.id,
            meta: { reason: "replayed_credential" },
          });
      }
      return null;
    }
    if (!grant.connectedAt)
      await recordAudit(tx, deps, auditContext(c), {
        action: "assistant.connected",
        targetType: "assistant_connection",
        targetId: grant.id,
        meta: { provider: assistantProvider(grant.redirectUri) },
      });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_MS / 1000,
      refresh_token: refresh,
      scope: ASSISTANT_SCOPE,
    };
  });
}
