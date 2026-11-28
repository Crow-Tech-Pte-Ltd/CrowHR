import { and, eq } from "drizzle-orm";
import { type SsoProvider, ssoProviders } from "../db/schema/auth.ts";
import type { Db } from "../db/types.ts";
import { loadSecuritySettings } from "./settings.ts";

/** A provider is configured when it has everything its flow needs (secrets or RP keys). */
export function isConfigured(
  p: Pick<SsoProvider, "kind" | "clientId" | "clientSecretEnc" | "privateJwksEnc" | "issuer">,
  managedSingpassIssuer?: string,
): boolean {
  if (!p.clientId || !p.issuer) return false;
  if (p.kind === "managed_singpass" && p.issuer !== managedSingpassIssuer) return false;
  return p.kind === "singpass" ? !!p.privateJwksEnc : !!p.clientSecretEnc;
}

export interface PublicSignInMethods {
  password: { enabled: boolean };
  providers: {
    id: string;
    kind: "google" | "entra" | "singpass" | "oidc";
    displayName: string;
    allowedDomains: string[];
  }[];
}

export function publicProviderKind(kind: SsoProvider["kind"]): PublicSignInMethods["providers"][number]["kind"] {
  return kind === "managed_singpass" ? "singpass" : kind;
}

/** What the sign-in page shows: only enabled and fully configured methods (auth spec). */
export async function publicSignInMethods(
  db: Db,
  orgId: string,
  managedSingpassIssuer?: string,
): Promise<PublicSignInMethods> {
  const settings = await loadSecuritySettings(db, orgId);
  const rows = await db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.orgId, orgId), eq(ssoProviders.enabled, true)));
  return {
    password: { enabled: settings.passwordEnabled },
    providers: rows
      .filter((provider) => isConfigured(provider, managedSingpassIssuer))
      // Oldest first; the id breaks ties (seeded providers share a timestamp), so the order never changes.
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((p) => ({
        id: p.id,
        kind: publicProviderKind(p.kind),
        displayName: p.displayName,
        allowedDomains: p.kind === "google" ? p.allowedDomains : [],
      })),
  };
}
