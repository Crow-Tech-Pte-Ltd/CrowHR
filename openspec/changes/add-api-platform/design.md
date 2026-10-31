## Context

The foundation mounts routes under `/api/*` with a `validate(target, zod)` helper. Identity adds cookie sessions, `authorize()` and audit. Mobile apps (`add-mobile-apps`, M4) are the first non-browser client. Requirements are in `specs/api-platform`.

## Goals / Non-Goals

**Goals:** one place where a route declares its contract; a breaking-change gate that runs in CI without network access or non-JS binaries; native auth that reuses the web sign-in page so every SSO provider works in the apps for free.

**Non-Goals:** a general OAuth 2 authorisation server. The native endpoints serve only the official Crow HR apps.

## Decisions

1. **The route helper is the contract.** `defineRoute({ method, path, auth, permission, request: {params, query, body}, responses: {200: schema, …}, errors: ['not_found', …], deprecated?: {sunset} })` registers the route with Hono, runs validation through the foundation's `validate()`, runs `authorize()`, and registers the route with an `OpenAPIRegistry` (`@asteasolutions/zod-to-openapi`, MIT, runtime-agnostic). Responses are parsed through the response schema in tests (strict mode) and stripped of unknown keys in production. Sensitive-field annotations from access-control become `x-sensitivity`. *Alternative:* `@hono/zod-openapi` (`OpenAPIHono`). It is fine, but it replaces Hono's routing style and the foundation's validator. A registry keeps both.

2. **Breaking-change gate in TypeScript.** `scripts/openapi-diff.ts` compares two documents structurally. It fails on: a removed path or method; a removed response property; a request property that was optional and is now required; a type change; a removed enum value; a newly added required request field. *Alternative:* `oasdiff`, a Go binary that adds a toolchain. Release snapshots are copied to `packages/core/openapi/releases/v1.<minor>.json` when a release is cut.

3. **Native auth reuses the web sign-in.**
   - `/api/v1/native/authorize` stores a `native_auth_requests` row (challenge, redirect URI, state, client, org; 10-minute TTL) and redirects to `/sign-in/<slug>?native=<id>`.
   - Once any method completes, the sign-in handler checks for a pending native request. Instead of keeping the browser session, it issues the code and redirects to the app scheme.
   - The browser session is created only transiently and is revoked at once, so the in-app browser does not stay signed in.
   - Redirect URIs come from the allow-list `NATIVE_REDIRECT_URIS`, defaulting to the official app schemes (for example `crowtech.crowhr:/oauth2redirect`, finalised with the mobile change). Self-hosters never need to change it.

4. **Opaque tokens in the database, not JWTs.** `device_sessions` holds the session. Access tokens are verified with one indexed lookup on `sha256(token)`, the same as cookie sessions, so `requireAuth` has two front doors and one context type. Refresh rotation uses a `refresh_family_id` with `current_refresh_hash` and a small `previous_refresh_hashes` set for reuse detection. *Alternative:* JWT access tokens, which save a lookup but make revocation lag by up to 15 minutes.

5. **CSRF exemption is keyed on the header, never the path.** A request with `Authorization: Bearer` and no session cookie skips the Origin check. A request carrying both is rejected with 400 `ambiguous_credentials`.

6. **Meta is cacheable.** `Cache-Control: public, max-age=60`. Its `features` list comes from module registration, so a module that is not built does not appear.

## Data model sketch

| Table | Key columns |
| --- | --- |
| `native_auth_requests` | `id`, `org_id`, `client`, `redirect_uri`, `code_challenge`, `state`, `expires_at`, `code_hash?`, `code_expires_at?`, `user_id?`, `used_at?` |
| `device_sessions` | `id`, `org_id`, `user_id`, `membership_id`, `platform`, `device_name`, `app_version`, `access_hash`, `access_expires_at`, `refresh_family_id`, `current_refresh_hash`, `previous_refresh_hashes[]`, `created_at`, `last_used_at`, `last_ip`, `idle_expires_at`, `absolute_expires_at`, `revoked_at?` |

## Risks / Trade-offs

- [Private-use URI schemes can be claimed by a malicious app on Android] → PKCE makes an intercepted code useless without the verifier. Codes last 60 s and are single-use (RFC 8252 §8.1).
- [Additive-only discipline slows refactors] → internal refactors are free. Only the wire shape is gated. A v2 is cheap if the migration window is honoured.
- [The route helper touches every module] → it must land before the module workstreams start writing routes. The roadmap puts it at the start of M1.

## Migration Plan

Before modules exist, the foundation's existing routes move under `/api/v1` except `/api/health`. The foundation owner makes that move on request; this change does not edit those files.
