import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { auditContext, diffFields, recordAudit } from "../audit/audit.ts";
import type { AppContext } from "../context.ts";
import { SECRET_PURPOSES } from "../crypto/secret-box.ts";
import { orgSecuritySettings, type SsoProvider, ssoProviders } from "../db/schema/auth.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { isConfigured } from "./methods.ts";
import { callbackUrl, discover, jwksUrl } from "./oidc/client.ts";
import { generateRpKeys, publicOnly } from "./oidc/keys.ts";
import { ENTRA_FORBIDDEN_TENANTS, entraIssuer, GOOGLE_ISSUER, PRESETS, SINGPASS_ISSUERS } from "./oidc/presets.ts";
import { noticeSignInSettingsChanged } from "./security-notices.ts";
import { loadSecuritySettings, sessionCookie } from "./settings.ts";

const kind = z.enum(["google", "entra", "singpass", "oidc"]);
const role = z.enum(["owner", "hr_admin", "payroll_admin"]);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter a domain like kampongkopi.sg, without @ or https://.");

const providerOut = z.object({
  id: z.uuid(),
  kind,
  displayName: z.string(),
  issuer: z.string(),
  clientId: z.string(),
  clientSecretSet: z.boolean(),
  privateKeysSet: z.boolean(),
  tenantId: z.string().nullable(),
  allowedDomains: z.array(z.string()),
  environment: z.enum(["staging", "production"]).nullable(),
  jitEnabled: z.boolean(),
  enabled: z.boolean(),
  configured: z.boolean(),
  lastTestOkAt: z.iso.datetime().nullable(),
  /** Register this redirect URI at the identity provider. */
  callbackUrl: z.string(),
  /** Singpass: give this JWKS URL to Singpass when registering the relying party. */
  jwksUrl: z.string().nullable(),
});

function present(deps: AppDeps, p: SsoProvider): z.input<typeof providerOut> {
  return {
    id: p.id,
    kind: p.kind,
    displayName: p.displayName,
    issuer: p.issuer,
    clientId: p.clientId,
    clientSecretSet: !!p.clientSecretEnc,
    privateKeysSet: !!p.privateJwksEnc,
    tenantId: p.tenantId,
    allowedDomains: p.allowedDomains,
    environment: p.environment,
    jitEnabled: p.jitEnabled,
    enabled: p.enabled,
    configured: isConfigured(p),
    lastTestOkAt: p.lastTestOkAt?.toISOString() ?? null,
    callbackUrl: callbackUrl(deps.publicUrl, p.id),
    jwksUrl: p.kind === "singpass" ? jwksUrl(deps.publicUrl, p.id) : null,
  };
}

const settingsOut = z.object({
  passwordEnabled: z.boolean(),
  mfaRequiredRoles: z.array(role),
  idleTimeoutMin: z.number().int(),
  absoluteTimeoutH: z.number().int(),
  deviceIdleDays: z.number().int(),
  /** PUBLIC_URL is plain http: cookies are not Secure. Show "Not using HTTPS". */
  insecureTransport: z.boolean(),
  emailConfigured: z.boolean(),
  demoMode: z.boolean(),
  providers: z.array(providerOut),
});

async function settingsView(c: AppContext, orgId: string): Promise<z.input<typeof settingsOut>> {
  const deps = c.var.deps;
  const s = await loadSecuritySettings(deps.db, orgId);
  const providers = await deps.db
    .select()
    .from(ssoProviders)
    .where(eq(ssoProviders.orgId, orgId))
    .orderBy(ssoProviders.createdAt);
  return {
    ...s,
    insecureTransport: !sessionCookie(deps.publicUrl).secure,
    emailConfigured: !!deps.mailer,
    demoMode: !!deps.demoMode,
    providers: providers.map((p) => present(deps, p)),
  };
}

const providerInput = z.object({
  kind,
  displayName: z.string().trim().min(1).max(60).optional(),
  /**
   * Required except for Singpass, which may be saved first: the Singpass Developer Portal asks for the
   * redirect URI and JWKS before it issues a client ID. Such a provider stays unconfigured (off).
   */
  clientId: z.string().trim().min(1, "Paste the client ID from your identity provider.").max(500).optional(),
  clientSecret: z.string().min(1).max(2000).optional(),
  /** Generic OIDC only: the issuer URL (discovery at <issuer>/.well-known/openid-configuration). */
  issuer: z.url({ error: "Enter the issuer URL, like https://login.example.com/realms/acme." }).max(500).optional(),
  /** Entra only: the directory (tenant) ID. */
  tenantId: z.string().trim().max(100).optional(),
  allowedDomains: z.array(domain).max(20).optional(),
  /** Singpass only. */
  environment: z.enum(["staging", "production"]).optional(),
  /** Singpass only: upload your own RP private JWKS instead of letting Crow HR generate keys. */
  privateJwks: z.object({ keys: z.array(z.looseObject({ kty: z.string() })).min(1) }).optional(),
  jitEnabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

type ProviderInput = z.output<typeof providerInput>;

function fieldError(path: string, message: string) {
  return new AppError("validation_failed", "Some fields need attention.", {
    target: "json",
    issues: [{ path, message }],
  });
}

/** Resolves the issuer from the preset and checks preset-specific rules. */
function resolveIssuer(input: Pick<ProviderInput, "kind" | "issuer" | "tenantId" | "environment">): string {
  switch (input.kind) {
    case "google":
      return GOOGLE_ISSUER;
    case "entra": {
      const tenant = input.tenantId?.trim();
      if (!tenant)
        throw fieldError(
          "tenantId",
          "Enter your Microsoft Entra tenant (directory) ID. It is on the Overview page of Microsoft Entra ID.",
        );
      if (ENTRA_FORBIDDEN_TENANTS.includes(tenant.toLowerCase())) {
        throw fieldError(
          "tenantId",
          `"${tenant}" would let any Microsoft account sign in. Enter your own tenant ID (a GUID) instead.`,
        );
      }
      return entraIssuer(tenant);
    }
    case "singpass":
      return input.issuer ?? SINGPASS_ISSUERS[input.environment ?? "staging"];
    case "oidc":
      if (!input.issuer) throw fieldError("issuer", "Enter the issuer URL of your identity provider.");
      return input.issuer.replace(/\/$/, "");
  }
}

async function checkDiscovery(deps: AppDeps, issuer: string, clientId: string) {
  try {
    await discover(deps, issuer, clientId);
  } catch (err) {
    deps.logger.info("OIDC discovery failed", { err, issuer });
    const message =
      err instanceof Error && /issuer/i.test(err.message) && !/fetch/i.test(err.message)
        ? `The discovery document at ${issuer}/.well-known/openid-configuration names a different issuer. Check the issuer URL exactly, including any trailing path.`
        : `The discovery document at ${issuer}/.well-known/openid-configuration could not be fetched. Check the issuer URL and that this server can reach it.`;
    throw fieldError("issuer", message);
  }
}

async function getProvider(c: AppContext, orgId: string, id: string): Promise<SsoProvider> {
  const [p] = await c.var.deps.db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.orgId, orgId), eq(ssoProviders.id, id)));
  if (!p) throw new AppError("not_found", "That sign-in method doesn't exist.");
  return p;
}

async function assertPasswordStillPossible(c: AppContext, orgId: string, excludingProviderId: string) {
  const s = await loadSecuritySettings(c.var.deps.db, orgId);
  if (s.passwordEnabled) return;
  const rows = await c.var.deps.db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.orgId, orgId), eq(ssoProviders.enabled, true), isNotNull(ssoProviders.lastTestOkAt)));
  if (!rows.some((r) => r.id !== excludingProviderId)) {
    throw new AppError(
      "conflict",
      "Staff would have no way to sign in. Turn email and password sign-in back on first, or enable another tested method.",
    );
  }
}

const AUDIT_SAFE_FIELDS = [
  "displayName",
  "issuer",
  "clientId",
  "tenantId",
  "allowedDomains",
  "environment",
  "jitEnabled",
  "enabled",
] as const;

/** "turned password sign-in off", "changed session timeouts"… for the owners' security notice. */
function settingsChangePhrases(changedKeys: readonly string[], patch: Record<string, unknown>): string[] {
  const out: string[] = [];
  const has = (k: string) => changedKeys.includes(k);
  if (has("passwordEnabled")) out.push(`turned password sign-in ${patch.passwordEnabled ? "on" : "off"}`);
  if (has("mfaRequiredRoles")) out.push("changed which roles must use two-step verification");
  if (has("idleTimeoutMin") || has("absoluteTimeoutH") || has("deviceIdleDays")) out.push("changed session timeouts");
  return out;
}

export const securityModule = defineModule({
  name: "security",
  basePath: "/security",
  tag: "Security settings",
  routes: [
    defineRoute({
      method: "get",
      path: "/settings",
      summary: "Sign-in methods, MFA policy and session timeouts",
      access: { permission: "security_settings:read" },
      responses: { 200: settingsOut },
      handler: ({ c, auth }) => settingsView(c, auth.orgId),
    }),

    defineRoute({
      method: "patch",
      path: "/settings",
      summary: "Change security settings",
      description:
        "Password sign-in can be turned off only once an SSO method is enabled and has passed a test sign-in. Owners keep break-glass password sign-in.",
      access: { permission: "security_settings:update" },
      recentAuth: true,
      request: {
        body: z.object({
          passwordEnabled: z.boolean().optional(),
          mfaRequiredRoles: z.array(role).optional(),
          idleTimeoutMin: z
            .number()
            .int()
            .min(15, "Use 15 to 240 minutes.")
            .max(240, "Use 15 to 240 minutes.")
            .optional(),
          absoluteTimeoutH: z.number().int().min(1, "Use 1 to 24 hours.").max(24, "Use 1 to 24 hours.").optional(),
          deviceIdleDays: z.number().int().min(1, "Use 1 to 90 days.").max(90, "Use 1 to 90 days.").optional(),
        }),
      },
      responses: { 200: settingsOut },
      errors: ["conflict"],
      handler: async ({ c, deps, auth, body }) => {
        const before = await loadSecuritySettings(deps.db, auth.orgId);
        if (body.passwordEnabled === false && before.passwordEnabled) {
          const tested = await deps.db
            .select()
            .from(ssoProviders)
            .where(
              and(
                eq(ssoProviders.orgId, auth.orgId),
                eq(ssoProviders.enabled, true),
                isNotNull(ssoProviders.lastTestOkAt),
              ),
            );
          if (!tested.length) {
            throw new AppError(
              "conflict",
              "Enable a single sign-on method and complete a test sign-in with it before turning off passwords.",
            );
          }
        }
        const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
        if (body.mfaRequiredRoles) patch.mfaRequiredRoles = [...new Set(body.mfaRequiredRoles)];
        const diff = diffFields(before as unknown as Record<string, unknown>, { ...before, ...patch });
        await deps.db.transaction(async (tx) => {
          await tx
            .update(orgSecuritySettings)
            .set({ ...patch, updatedAt: deps.clock.now() })
            .where(eq(orgSecuritySettings.orgId, auth.orgId));
          await recordAudit(tx, deps, auditContext(c), {
            action: "security_settings.updated",
            targetType: "organisation",
            targetId: auth.orgId,
            diff,
          });
          const changed = settingsChangePhrases(Object.keys(diff ?? {}), patch);
          if (changed.length) {
            await noticeSignInSettingsChanged(tx, deps, {
              orgId: auth.orgId,
              actorName: auth.user.displayName || auth.user.email,
              what: changed.join(" and "),
            });
          }
        });
        return settingsView(c, auth.orgId);
      },
    }),

    defineRoute({
      method: "post",
      path: "/providers",
      summary: "Add a single sign-on provider",
      description:
        "Fetches and checks the discovery document before saving. Secrets are encrypted at rest and never returned.",
      access: { permission: "security_settings:update" },
      recentAuth: true,
      request: { body: providerInput },
      responses: { 201: providerOut },
      errors: ["conflict"],
      handler: async ({ c, deps, auth, body }) => {
        const preset = PRESETS[body.kind];
        const issuer = resolveIssuer(body);
        if (!body.clientId && body.kind !== "singpass")
          throw fieldError("clientId", "Paste the client ID from your identity provider.");
        if (body.enabled && !body.clientId)
          throw new AppError(
            "conflict",
            "Singpass is not configured yet: add the client ID and relying-party keys first.",
          );
        if (!preset.privateKeyJwt && !body.clientSecret)
          throw fieldError("clientSecret", "Paste the client secret from your identity provider.");
        if (body.jitEnabled && !preset.jitAllowed)
          throw fieldError("jitEnabled", "Just-in-time accounts are not available for Singpass.");
        if (body.jitEnabled && !(body.allowedDomains ?? []).length)
          throw fieldError("allowedDomains", "Add at least one allowed domain to turn on just-in-time accounts.");
        // Without a client ID (Singpass, not yet issued) discovery is checked when the client ID is added.
        if (body.clientId) await checkDiscovery(deps, issuer, body.clientId);
        const now = deps.clock.now();
        let privateJwksEnc: string | null = null;
        let publicJwks: unknown = null;
        if (preset.privateKeyJwt) {
          const keys = body.privateJwks
            ? {
                privateJwks: body.privateJwks as { keys: JsonWebKey[] },
                publicJwks: { keys: (body.privateJwks.keys as JsonWebKey[]).map(publicOnly) },
              }
            : await generateRpKeys();
          privateJwksEnc = await deps.secretBox.encrypt(
            SECRET_PURPOSES.ssoPrivateJwks,
            JSON.stringify(keys.privateJwks),
          );
          publicJwks = keys.publicJwks;
        }
        const id = deps.ids.newId();
        await deps.db.transaction(async (tx) => {
          await tx.insert(ssoProviders).values({
            id,
            orgId: auth.orgId,
            kind: body.kind,
            displayName:
              body.displayName ??
              (body.kind === "oidc"
                ? "Single sign-on"
                : preset.label.replace(" Workspace", "").replace(" Entra ID", "")),
            issuer,
            clientId: body.clientId ?? "",
            clientSecretEnc: body.clientSecret
              ? await deps.secretBox.encrypt(SECRET_PURPOSES.ssoClientSecret, body.clientSecret)
              : null,
            privateJwksEnc,
            publicJwks,
            allowedDomains: body.allowedDomains ?? [],
            tenantId: body.kind === "entra" ? (body.tenantId ?? null) : null,
            environment: body.kind === "singpass" ? (body.environment ?? "staging") : null,
            jitEnabled: body.jitEnabled ?? false,
            enabled: false,
            createdAt: now,
            updatedAt: now,
          });
          await recordAudit(tx, deps, auditContext(c), {
            action: "sso.provider_created",
            targetType: "sso_provider",
            targetId: id,
            meta: {
              kind: body.kind,
              issuer,
              clientSecretSet: !!body.clientSecret,
              generatedKeys: preset.privateKeyJwt && !body.privateJwks,
            },
          });
        });
        if (body.enabled) {
          // Enabling is a separate, audited step so it can't happen on an unconfigured provider.
          const [p] = await deps.db
            .update(ssoProviders)
            .set({ enabled: true })
            .where(eq(ssoProviders.id, id))
            .returning();
          if (p)
            await recordAudit(deps.db, deps, auditContext(c), {
              action: "sso.provider_updated",
              targetType: "sso_provider",
              targetId: id,
              diff: { enabled: { from: false, to: true } },
            });
        }
        const created = await getProvider(c, auth.orgId, id);
        await noticeSignInSettingsChanged(deps.db, deps, {
          orgId: auth.orgId,
          actorName: auth.user.displayName || auth.user.email,
          what: `added the single sign-on method ${created.displayName}${created.enabled ? " and turned it on" : ""}`,
        });
        return present(deps, created);
      },
    }),

    defineRoute({
      method: "get",
      path: "/providers/:id",
      summary: "Get a single sign-on provider (secrets are never returned)",
      access: { permission: "security_settings:read" },
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: providerOut },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => present(deps, await getProvider(c, auth.orgId, params.id)),
    }),

    defineRoute({
      method: "patch",
      path: "/providers/:id",
      summary: "Change a single sign-on provider",
      access: { permission: "security_settings:update" },
      recentAuth: true,
      request: { params: z.object({ id: z.uuid() }), body: providerInput.omit({ kind: true }).partial() },
      responses: { 200: providerOut },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params, body }) => {
        const current = await getProvider(c, auth.orgId, params.id);
        const preset = PRESETS[current.kind];
        const issuer =
          body.issuer !== undefined || body.tenantId !== undefined || body.environment !== undefined
            ? resolveIssuer({
                kind: current.kind,
                issuer: body.issuer ?? (current.kind === "oidc" ? current.issuer : undefined),
                tenantId: body.tenantId ?? current.tenantId ?? undefined,
                environment: body.environment ?? current.environment ?? undefined,
              })
            : current.issuer;
        const clientId = body.clientId ?? current.clientId;
        if (clientId && (issuer !== current.issuer || clientId !== current.clientId))
          await checkDiscovery(deps, issuer, clientId);
        const allowedDomains = body.allowedDomains ?? current.allowedDomains;
        const jitEnabled = body.jitEnabled ?? current.jitEnabled;
        if (jitEnabled && !preset.jitAllowed)
          throw fieldError("jitEnabled", "Just-in-time accounts are not available for Singpass.");
        if (jitEnabled && !allowedDomains.length)
          throw fieldError("allowedDomains", "Add at least one allowed domain to turn on just-in-time accounts.");
        if (body.enabled === false && current.enabled) await assertPasswordStillPossible(c, auth.orgId, current.id);
        const changesIdentity = issuer !== current.issuer || clientId !== current.clientId;
        const next: Partial<SsoProvider> = {
          displayName: body.displayName ?? current.displayName,
          issuer,
          clientId,
          tenantId: current.kind === "entra" ? (body.tenantId ?? current.tenantId) : null,
          environment: current.kind === "singpass" ? (body.environment ?? current.environment) : null,
          allowedDomains,
          jitEnabled,
          enabled: body.enabled ?? current.enabled,
          updatedAt: deps.clock.now(),
          // A new issuer or client must pass a fresh test before passwords can be turned off.
          ...(changesIdentity ? { lastTestOkAt: null } : {}),
        };
        if (body.clientSecret)
          next.clientSecretEnc = await deps.secretBox.encrypt(SECRET_PURPOSES.ssoClientSecret, body.clientSecret);
        if (body.privateJwks && preset.privateKeyJwt) {
          next.privateJwksEnc = await deps.secretBox.encrypt(
            SECRET_PURPOSES.ssoPrivateJwks,
            JSON.stringify(body.privateJwks),
          );
          next.publicJwks = { keys: (body.privateJwks.keys as JsonWebKey[]).map(publicOnly) };
        }
        if (next.enabled && !isConfigured({ ...current, ...next } as SsoProvider)) {
          throw new AppError(
            "conflict",
            current.kind === "singpass"
              ? "Singpass is not configured yet: add the client ID and relying-party keys first."
              : "Add the client ID and secret before enabling this method.",
          );
        }
        await deps.db.transaction(async (tx) => {
          await tx
            .update(ssoProviders)
            .set(next)
            .where(and(eq(ssoProviders.orgId, auth.orgId), eq(ssoProviders.id, current.id)));
          const diff = diffFields(
            Object.fromEntries(AUDIT_SAFE_FIELDS.map((k) => [k, current[k]])),
            Object.fromEntries(AUDIT_SAFE_FIELDS.map((k) => [k, (next as Record<string, unknown>)[k]])),
          );
          if (body.clientSecret) diff.clientSecret = { changed: true };
          if (body.privateJwks) diff.privateJwks = { changed: true };
          await recordAudit(tx, deps, auditContext(c), {
            action: "sso.provider_updated",
            targetType: "sso_provider",
            targetId: current.id,
            diff,
          });
          if (Object.keys(diff).length) {
            const toggled =
              diff.enabled && Object.keys(diff).length === 1
                ? `turned the single sign-on method ${current.displayName} ${next.enabled ? "on" : "off"}`
                : `changed the single sign-on method ${current.displayName}`;
            await noticeSignInSettingsChanged(tx, deps, {
              orgId: auth.orgId,
              actorName: auth.user.displayName || auth.user.email,
              what: toggled,
            });
          }
        });
        return present(deps, await getProvider(c, auth.orgId, current.id));
      },
    }),

    defineRoute({
      method: "delete",
      path: "/providers/:id",
      summary: "Remove a single sign-on provider",
      description: "Linked identities are removed with it.",
      access: { permission: "security_settings:update" },
      recentAuth: true,
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        const current = await getProvider(c, auth.orgId, params.id);
        if (current.enabled) await assertPasswordStillPossible(c, auth.orgId, current.id);
        await deps.db.transaction(async (tx) => {
          await tx.delete(ssoProviders).where(and(eq(ssoProviders.orgId, auth.orgId), eq(ssoProviders.id, current.id)));
          await recordAudit(tx, deps, auditContext(c), {
            action: "sso.provider_deleted",
            targetType: "sso_provider",
            targetId: current.id,
            meta: { kind: current.kind },
          });
          await noticeSignInSettingsChanged(tx, deps, {
            orgId: auth.orgId,
            actorName: auth.user.displayName || auth.user.email,
            what: `removed the single sign-on method ${current.displayName}`,
          });
        });
        return undefined;
      },
    }),
  ],
});
