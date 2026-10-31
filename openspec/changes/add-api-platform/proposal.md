## Why

Native mobile apps (M4) and future integrations will call the same API as the web app. Mobile clients lag server versions by months, and self-hosted servers lag releases. Without a versioned, documented contract, every server change risks breaking an app we cannot force-update. Cookie sessions also do not suit native apps. They need short-lived bearer tokens obtained through the system browser, so every sign-in method (password, Google, Entra, Singpass, OIDC) keeps working unchanged. This must be settled in M1, before modules add dozens of routes.

## What Changes

- **Versioned API.** All module routes are mounted under `/api/v1`. Within v1, changes are additive only. A breaking change means `/api/v2`, and v1 is kept for at least 12 months after v2 ships. Deprecated routes send `Deprecation` and `Sunset` headers. Unversioned `/api/health` stays.
- **`GET /api/v1/meta`** (unauthenticated): server version, supported API versions, a feature list of enabled modules, and, per organisation slug, display name, logo URL and enabled sign-in methods. Mobile onboarding and the sign-in page use it.
- **OpenAPI 3.1 document** generated from the same zod schemas that validate requests and responses, served at `/api/v1/openapi.json`. It is committed as a snapshot, and CI fails on breaking differences against the last release.
- **Native-client token auth** (RFC 8252 pattern):
  - The app opens the server's normal sign-in page in the system browser, using PKCE (S256) and a private-use redirect scheme.
  - After sign-in by any method, the server issues a one-time authorisation code. The app exchanges it for an access token (15 minutes) and a rotating refresh token (30-day idle, 90-day absolute).
  - Refresh-token reuse revokes the whole device session.
- **Device sessions** (device name, platform, app version, last used) appear alongside browser sessions in My sessions. Members can revoke them, and owners can revoke a member's devices. Suspension, password reset and "sign out everywhere" revoke them.
- **Bearer-token requests** skip CSRF checks, never accept tokens from query strings, and use the same `authorize()` and the same audit events as cookie sessions.

## Capabilities

### New Capabilities
- `api-platform`: API versioning and deprecation policy, the meta endpoint, the generated OpenAPI document, native-client authorisation code + PKCE flow, access and refresh tokens, and device sessions.

### Modified Capabilities
None. `add-identity-and-access` is not yet archived. Its session list and CSRF requirements already reference bearer tokens defined here.

## Non-goals

- Personal access tokens and integration API keys for third parties (P1).
- Webhooks and an OAuth server for third-party apps (scopes, consent screens).
- GraphQL, gRPC, or a public SDK. The OpenAPI document is the SDK seed.
- Rate-limit tiers per client. The auth throttles from identity apply.
- API changes that the mobile apps need beyond auth and meta. Each module's spec owns its endpoints.

## Impact

- `packages/core`:
  - a route-definition helper that registers zod request/response schemas for validation and OpenAPI (built on `@asteasolutions/zod-to-openapi`);
  - all module routers mounted under `/api/v1`;
  - new `auth/native/` (authorisation code, token, refresh, revoke) and schema `device_sessions`, `native_auth_codes`.
- **Foundation coordination:** the foundation's `validate()` helper becomes the validation half of the route helper. Module routes are written with the helper from day one. The foundation owner should mount the v1 router; this change does not edit foundation files.
- CI: an `openapi:check` script comparing the generated document with `packages/core/openapi/v1.snapshot.json`.
- `apps/docs`: an API reference page rendered from the snapshot.
