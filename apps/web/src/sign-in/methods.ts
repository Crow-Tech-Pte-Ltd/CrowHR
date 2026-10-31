/**
 * Sign-in methods an organisation can enable (AGENTS.md "Authentication").
 * The shape is what the sign-in page renders from; the auth workstream will
 * serve it from the API per organisation. NOT IMPLEMENTED: none of these work.
 */
export type SignInMethod =
  | { type: "password" /** false = staff use SSO; owner break-glass password remains. */; staffEnabled: boolean }
  | { type: "google"; hostedDomain?: string }
  | { type: "microsoft"; tenantName?: string }
  | { type: "singpass" }
  | { type: "oidc"; displayName: string };

/** FIXTURES — sample configurations for design review. */
export const SIGN_IN_FIXTURES = {
  all: [
    { type: "singpass" },
    { type: "google", hostedDomain: "kampongkopi.example" },
    { type: "microsoft" },
    { type: "oidc", displayName: "Okta" },
    { type: "password", staffEnabled: true },
  ],
  password: [{ type: "password", staffEnabled: true }],
  sso: [
    { type: "google", hostedDomain: "kampongkopi.example" },
    { type: "password", staffEnabled: false },
  ],
} satisfies Record<string, SignInMethod[]>;

export type SignInFixture = keyof typeof SIGN_IN_FIXTURES;
