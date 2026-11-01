/**
 * Whether an ID token asserts that the identity provider performed multi-factor authentication,
 * from its `amr` claim (RFC 8176 values). Entra sends `["pwd", "mfa"]`, Okta `["mfa", ...]`,
 * A single factor name does not assert MFA. Google ID tokens carry no `amr`, so a Google sign-in
 * never counts as MFA here (security review finding 1: see `mfa-policy.ts` for what follows).
 *
 * `amr` is only trusted from the organisation's own configured provider, after the token's
 * signature, issuer, audience and nonce were validated.
 */
export function idpAssertsMfa(claims: Record<string, unknown>): boolean {
  // A single OTP, key, or biometric does not establish that *multiple* factors were used.
  return Array.isArray(claims.amr) && claims.amr.includes("mfa");
}

/**
 * Entra ID (security review, "Entra email trust"): `email` is not verified by Microsoft just
 * because the tenant matches (any tenant user can set an unverified address). Trust it only when
 * the optional `xms_edov` claim says the email's domain is verified by the tenant; otherwise
 * Entra identities link only through an invitation or an already linked subject.
 */
export function entraEmailVerified(claims: Record<string, unknown>): boolean {
  const v = claims.xms_edov;
  return v === true || v === 1 || v === "1" || v === "true";
}
