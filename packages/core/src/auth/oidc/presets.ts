/**
 * Provider presets (design decision 9): one OIDC implementation, behaviour as data.
 *
 * Singpass values follow the Singpass developer docs for the FAPI 2.0 login flow (PAR, PKCE,
 * private_key_jwt, DPoP-bound tokens, encrypted ID tokens). NOT VERIFIED against real Singpass:
 * they are exercised only against the in-process mock IdP. Check the current docs at
 * https://docs.developer.singpass.gov.sg before onboarding, and record the doc version checked in
 * the setup guide.
 */
export type ProviderKind = "google" | "entra" | "singpass" | "oidc";

export interface ProviderPreset {
  kind: ProviderKind;
  label: string;
  scopes: string;
  /** Pushed authorisation requests (RFC 9126). */
  par: boolean;
  /** DPoP-bound tokens (RFC 9449). */
  dpop: boolean;
  /** private_key_jwt client authentication with RP-held keys (no client secret). */
  privateKeyJwt: boolean;
  /** ID token arrives as a JWE encrypted to the RP's key. */
  idTokenEncrypted: boolean;
  /** Email may be used to link a first sign-in to a pre-provisioned member. */
  emailLinking: boolean;
  /** JIT provisioning may be enabled. */
  jitAllowed: boolean;
}

export const PRESETS: Record<ProviderKind, ProviderPreset> = {
  google: {
    kind: "google",
    label: "Google Workspace",
    scopes: "openid email profile",
    par: false,
    dpop: false,
    privateKeyJwt: false,
    idTokenEncrypted: false,
    emailLinking: true,
    jitAllowed: true,
  },
  entra: {
    kind: "entra",
    label: "Microsoft Entra ID",
    scopes: "openid email profile",
    par: false,
    dpop: false,
    privateKeyJwt: false,
    idTokenEncrypted: false,
    emailLinking: true,
    jitAllowed: true,
  },
  singpass: {
    kind: "singpass",
    label: "Singpass",
    scopes: "openid",
    par: true,
    dpop: true,
    privateKeyJwt: true,
    idTokenEncrypted: true,
    emailLinking: false,
    jitAllowed: false,
  },
  oidc: {
    kind: "oidc",
    label: "OpenID Connect",
    scopes: "openid email profile",
    par: false,
    dpop: false,
    privateKeyJwt: false,
    idTokenEncrypted: false,
    emailLinking: true,
    jitAllowed: true,
  },
};

export const GOOGLE_ISSUER = "https://accounts.google.com";
/**
 * Singpass FAPI 2.0 issuers (PAR, DPoP, private_key_jwt). Checked against live discovery on 9 Nov 2026:
 * https://stg-id.singpass.gov.sg/fapi/.well-known/openid-configuration and
 * https://id.singpass.gov.sg/fapi/.well-known/openid-configuration. The bare hosts are the older
 * Singpass Login API, which advertises no PAR or DPoP.
 */
export const SINGPASS_ISSUERS = {
  staging: "https://stg-id.singpass.gov.sg/fapi",
  production: "https://id.singpass.gov.sg/fapi",
} as const;

/** Entra multi-tenant aliases are refused: the tenant restriction must name one tenant. */
export const ENTRA_FORBIDDEN_TENANTS = ["common", "organizations", "consumers"];

export function entraIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

/**
 * Singpass `sub` has been documented as `s=<NRIC>,u=<UUID>` in older versions. Store only the
 * UUID so no NRIC ever lands in `user_identities`.
 */
export function singpassSubject(sub: string): string {
  const m = /(?:^|,)u=([^,]+)/.exec(sub);
  return m ? (m[1] as string) : sub;
}
