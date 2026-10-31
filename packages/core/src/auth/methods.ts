import { and, eq } from "drizzle-orm";
import { type SsoProvider, ssoProviders } from "../db/schema/auth.ts";
import type { Db } from "../db/types.ts";
import { loadSecuritySettings } from "./settings.ts";

/** A provider is configured when it has everything its flow needs (secrets or RP keys). */
export function isConfigured(
  p: Pick<SsoProvider, "kind" | "clientId" | "clientSecretEnc" | "privateJwksEnc" | "issuer">,
): boolean {
  if (!p.clientId || !p.issuer) return false;
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

/** What the sign-in page shows: only enabled and fully configured methods (auth spec). */
export async function publicSignInMethods(db: Db, orgId: string): Promise<PublicSignInMethods> {
  const settings = await loadSecuritySettings(db, orgId);
  const rows = await db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.orgId, orgId), eq(ssoProviders.enabled, true)));
  return {
    password: { enabled: settings.passwordEnabled },
    providers: rows
      .filter(isConfigured)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        displayName: p.displayName,
        allowedDomains: p.kind === "google" ? p.allowedDomains : [],
      })),
  };
}
