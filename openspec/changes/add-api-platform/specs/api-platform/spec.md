## Purpose

Defines the stable, documented HTTP API contract that the web app, the native mobile apps and future integrations rely on: versioning, discovery, the OpenAPI document, and token authentication for native clients.

## ADDED Requirements

### Requirement: Versioned API paths
All application endpoints SHALL be served under `/api/v1/`. `/api/health` SHALL remain unversioned. Within a major version, changes SHALL be additive only: new endpoints, new optional request fields, new response fields, and new enum values only where the schema marks the enum as extensible. Removing or renaming a field or endpoint, tightening validation, or changing a field's type or meaning SHALL require a new major version. After `/api/v2` is released, `/api/v1` SHALL continue to be served for at least 12 months. Deprecated endpoints SHALL send a `Deprecation` header and a `Sunset` header with the removal date.

#### Scenario: Unknown version
- **WHEN** a client calls `/api/v9/employees`
- **THEN** the response is 404 `not_found` with `details.supportedVersions: ["v1"]`

#### Scenario: Deprecated endpoint
- **WHEN** a client calls an endpoint marked deprecated with sunset 1 Jan 2028
- **THEN** the response succeeds and carries `Deprecation` and `Sunset: Sat, 01 Jan 2028 00:00:00 GMT` headers

### Requirement: Server meta endpoint
`GET /api/v1/meta` SHALL be public. It SHALL return: `serverVersion`; `apiVersions`; `features` (enabled modules such as `leave`, `claims`, `attendance` and `scheduling`); `demo` (boolean); and `organisations`. When the install has exactly one organisation, that organisation is included. Otherwise only the organisation named by the `?org=<slug>` query is included. Each organisation entry gives `slug`, `displayName`, `logoUrl` and its enabled sign-in methods (kind and display name only). The endpoint SHALL NOT list the organisations of a multi-organisation install without a slug, and SHALL NOT expose member counts, emails or configuration secrets.

#### Scenario: Multi-org install without slug
- **WHEN** a client calls `/api/v1/meta` on an install with 3 organisations and no `org` query
- **THEN** `organisations` is an empty array and `orgSlugRequired` is true

### Requirement: Generated OpenAPI document
The server SHALL serve an OpenAPI 3.1 document at `/api/v1/openapi.json`. It is generated from the same schemas that validate each route's input and serialise its output, and it covers every v1 route, its auth requirement, its error codes and its sensitive fields (marked with `x-sensitivity`). The repository SHALL hold a committed snapshot of the document. The check task SHALL fail when the generated document differs from the snapshot, and SHALL fail with a list of breaking differences when a change is not additive against the last released snapshot.

#### Scenario: Field removed
- **WHEN** a developer removes `preferredName` from the employee response schema
- **THEN** the check fails, naming `GET /api/v1/employees/{id}` → `preferredName` as a breaking removal

#### Scenario: Undocumented route impossible
- **WHEN** a route is registered without request and response schemas
- **THEN** the app fails to build its router at startup in tests with a message naming the route

### Requirement: Native client authorisation
Native clients SHALL obtain tokens with an authorisation code and PKCE:
1. The client opens `/api/v1/native/authorize?org=<slug>&client=<ios|android>&redirect_uri=<registered scheme URI>&code_challenge=<S256>&state=<random>` in the system browser.
2. The server sends the user through the organisation's normal sign-in page, using any enabled method, MFA policy included.
3. The server redirects to the redirect URI with a one-time `code`, valid for 60 seconds, plus `state`.
4. The client exchanges the code and its `code_verifier` at `POST /api/v1/native/token`.

Only the redirect URIs of the official app schemes listed in server configuration SHALL be accepted. A code SHALL be usable once. A wrong verifier SHALL invalidate the code. Browser sessions created during this flow SHALL be ended once the code is issued.

#### Scenario: Code replay
- **WHEN** an authorisation code that was already exchanged is presented again
- **THEN** the response is 400 `invalid_grant` and the device session created by the first exchange is revoked

#### Scenario: Unregistered redirect
- **WHEN** an authorisation request names `redirect_uri=https://evil.example/cb`
- **THEN** the server shows an error page and does not redirect

### Requirement: Access and refresh tokens
The token endpoint SHALL return an opaque access token (256-bit, valid 15 minutes) and an opaque refresh token (256-bit). Both are stored only as hashes. Each refresh SHALL return a new refresh token and invalidate the old one. Presenting an invalidated refresh token SHALL revoke the device session and all its tokens, and record `auth.refresh_reuse_detected`. A device session SHALL expire after 30 days without a refresh (owners can set 1 to 90) and after 90 days absolute, after which the user signs in again. API requests SHALL accept tokens only in the `Authorization: Bearer` header. Tokens SHALL carry the same permissions as the member and be re-checked on every request, so role changes and suspension apply immediately.

#### Scenario: Refresh reuse
- **WHEN** a refresh token is used, and then the previous refresh token is presented by another party
- **THEN** both the attacker and the legitimate device are signed out, and the user and owners see the event in the audit log

#### Scenario: Token in query string
- **WHEN** a request passes `?access_token=<valid>`
- **THEN** it is treated as unauthenticated (401)

### Requirement: Device sessions
Each successful native token exchange SHALL create a device session recording device name (client-supplied, at most 60 characters), platform, app version, created time, last-used time and last IP address. Device sessions SHALL appear with browser sessions in My sessions, marked as mobile, and SHALL be revocable there by the user. Owners SHALL be able to list and revoke any member's device sessions. Password change, password reset, membership suspension and becoming `former` SHALL revoke device sessions (former members use the web app). Revocation SHALL take effect on the next request.

#### Scenario: Lost phone
- **WHEN** an employee revokes "Pixel 9 (Android)" from My sessions on the web
- **THEN** the phone's next API call returns 401 `session_revoked` and the app returns to its connect/sign-in screen
