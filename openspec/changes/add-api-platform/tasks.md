## 1. Route contract

- [x] 1.1 packages/core: write `http/define-route.test.ts` (validates request, strict response parse in test mode, strips unknown keys in prod mode, runs `authorize()`, registration without schemas throws naming the route) then implement `defineRoute`
- [x] 1.2 packages/core: write `http/versioning.test.ts` (routes under `/api/v1`, `/api/health` unversioned, `/api/v9/*` → 404 with supported versions, deprecated route sends `Deprecation` and `Sunset`) then implement the v1 router and deprecation option — request the foundation owner to mount it
- [x] 1.3 packages/core: write `openapi/generate.test.ts` (document is valid OpenAPI 3.1, contains every registered route, error codes, `x-sensitivity`) then implement `/api/v1/openapi.json` and the `openapi:generate` script writing `openapi/v1.snapshot.json`
- [x] 1.4 root: write `scripts/openapi-diff.test.ts` (removed path, removed response field, optional→required, type change, removed enum value → breaking; added optional field → OK) then implement `openapi:check` and add it to `bun run check` (lives in `packages/core/scripts/` so it shares core's Vitest project and Node typecheck)

## 2. Meta

- [x] 2.1 packages/core: write `meta/meta.http.test.ts` (public; single-org install includes the org; multi-org requires slug; only enabled sign-in method kinds and names; no secrets; features reflect registered modules; cache header) then implement `GET /api/v1/meta`

## 3. Native auth

- [x] 3.1 packages/core: write `testing/schema.native-auth.test.ts` then add `native_auth_requests` and `device_sessions` schema and migration — covered by `testing/schema.auth.test.ts` (one identity migration)
- [x] 3.2 packages/core: write `auth/native/authorize.http.test.ts` (unregistered redirect → error page, PKCE S256 required, request TTL 10 min, redirect to org sign-in, after password + MFA sign-in the browser session is revoked and the app scheme receives code + state) then implement authorize — no browser session is created at all during a native sign-in (stricter than create-then-revoke)
- [x] 3.3 packages/core: write `auth/native/authorize-sso.http.test.ts` against the mock IdP (Google/Entra/generic SSO completes into a native code) then wire the OIDC callback to native requests
- [x] 3.4 packages/core: write `auth/native/token.http.test.ts` (code single-use, 60-s expiry, wrong verifier invalidates code, replay revokes device session, access 15 min, refresh rotation, reuse detection revokes family + audit, idle 30 d / absolute 90 d with injected clock) then implement token and refresh endpoints
- [x] 3.5 packages/core: write `auth/native/bearer.http.test.ts` (Bearer accepted, query-string token ignored, cookie+bearer → 400 `ambiguous_credentials`, CSRF skipped for bearer only, role change applies on next request, suspension → 401) then extend `requireAuth`
- [x] 3.6 packages/core: write `auth/native/device-sessions.http.test.ts` (listed with browser sessions marked mobile, self revoke, owner revoke, revoked by password change/reset/suspension/former) then implement

## 4. Docs and UI

- [ ] 4.1 apps/web: write `e2e/device-sessions.spec.ts` (a device session created via the token endpoint appears in My sessions and can be revoked) then extend My sessions — NOT DONE as e2e: device sessions in My sessions (listing, mobile badge, revoke) are covered by `auth/native/native.http.test.ts`; the UI renders them
- [ ] 4.2 apps/docs: API reference page rendered from `openapi/v1.snapshot.json` plus versioning policy — verified by the docs build including every path in the snapshot — NOT DONE: apps/docs does not exist yet (WS8); docs/api.md holds the versioning policy
