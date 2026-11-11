# HTTP API

The web app, the native apps (M4) and integrations all use the same versioned REST API. The contract is generated from the route declarations in `packages/core` and served at `GET /api/v1/openapi.json`. A committed snapshot lives in `packages/core/openapi/v1.snapshot.json`.

## Versions and compatibility

- Every application endpoint is under `/api/v1/`. `GET /api/health` stays unversioned.
- **Within v1, changes are additive only.** Allowed: new endpoints, new optional request fields or query parameters, new response fields, and new enum values only where the schema sets `x-extensible-enum: true`.
- **Breaking** (needs `/api/v2`): removing or renaming an endpoint or field, making an optional input required, adding a required input, changing a field's type or meaning, removing an enum value, adding a value to a closed response enum, or tightening validation.
- After `/api/v2` ships, `/api/v1` is served for **at least 12 months**.
- A deprecated endpoint answers normally and adds `Deprecation: @<unix seconds>` (RFC 9745) and `Sunset: <HTTP date>` (RFC 8594). Declare it with `deprecated: { since, sunset }` on the route.
- An unsupported version (`/api/v9/...`) answers `404 not_found` with `details.supportedVersions: ["v1"]`.

Mobile apps and self-hosted servers lag releases by months, so these rules are what lets an old app keep working against a new server and a new app against an old one.

### The check

`bun run check` runs `openapi:check`, which fails when:

1. `openapi/v1.snapshot.json` differs from what the code generates. Fix: `bun run openapi:generate` and commit the snapshot (reviewers see the contract diff in the PR).
2. The generated document has breaking changes against the newest released snapshot in `packages/core/openapi/releases/v1.<minor>.json`. The output names each operation and field. When a release is cut, copy the snapshot there and bump `API_CONTRACT_VERSION` in `src/openapi/generate.ts`. `v1.0.json` is the snapshot of tag `v1.0.0`, the contract the 1.0.0 iOS and Android apps were built against.

The diff is plain TypeScript (`packages/core/scripts/openapi-diff.ts`), so it runs offline in CI with no extra toolchain.

## Requests and responses

| Topic | Convention |
| --- | --- |
| Bodies | JSON only (`Content-Type: application/json`). Field names are camelCase. |
| IDs | UUIDv7 strings. |
| Money | Integer cents, `…Cents` suffix (`basicPayCents: 450000`). Never floats. |
| Dates | `YYYY-MM-DD` for calendar dates (Singapore local); ISO 8601 UTC (`2026-10-31T01:00:00.000Z`) for instants. |
| Sensitive fields | Marked `x-sensitivity: salary\|nric\|bank\|medical` in the document. Omitted for readers without access and listed in `redactedFields`. NRIC/FIN is masked (`S****567D`) unless revealed through the dedicated endpoint. |
| Unknown fields | Request schemas reject or ignore them as declared; responses never contain undeclared fields (tests run in strict mode and fail on them). |

### Lists

```
GET /api/v1/members?page=2&pageSize=50&sort=-createdAt&q=tan&status=active,invited
200 { "items": [...], "page": 2, "pageSize": 50, "total": 132 }
```

- `page` is 1-based. `pageSize` defaults to 50, maximum 200.
- `sort` is one declared field; prefix `-` for descending. A stable tiebreaker (the ID) is always applied.
- `q` is free-text search where the endpoint supports it.
- Filters are query parameters named after the field. Multi-value filters are comma-separated. Date ranges are `<field>From` / `<field>To`, inclusive.

Build them with `listQuery()`, `pageOf()`, `csvEnum()` and `orderByFor()` from `packages/core/src/http/list.ts`.

### Errors

Every error uses one envelope:

```json
{ "error": { "code": "validation_failed", "message": "Some fields need attention.", "requestId": "…", "details": { "target": "json", "issues": [{ "path": "email", "message": "Enter a valid email address, like name@company.sg." }] } } }
```

Clients switch on `code`, never on `message`. The message says what went wrong and how to fix it. Each operation lists its possible codes under `x-error-codes` in the OpenAPI document. Codes are defined in `packages/core/src/errors.ts`; adding a code is additive, and changing a code's status is breaking.

`401` codes: `unauthenticated`, `invalid_credentials`, `invalid_mfa_code`, `session_expired`, `session_revoked`. `403` codes: `forbidden`, `csrf_rejected`, `reauth_required`, `mfa_enrolment_required`, `password_sign_in_disabled`, `self_change_requires_approval`, `disabled_in_demo`. `404 not_found` is also used for records outside the caller's organisation or scope, so existence is never revealed. `409`: `conflict`, `last_owner`, `setup_required`, `duplicate_id_number` (the NRIC/FIN belongs to another employee, including a former one; `details.existingEmployeeId` points at the rehire flow), `in_use` (a structure entry used by current employees; `details.count` and `details.link`), `reporting_cycle` (the chosen manager reports to this employee). `429 rate_limited` carries `Retry-After`.

## Authentication

- **Browser**: an HttpOnly session cookie (`__Host-crowhr_session`, or `crowhr_session` when `PUBLIC_URL` is plain http). State-changing requests must be same-origin (`Origin` / `Sec-Fetch-Site` checked) or they get `403 csrf_rejected`.
- **Native apps**: `Authorization: Bearer <access token>` from the native authorisation-code + PKCE flow. Tokens are never accepted in query strings. A request carrying both a cookie and a bearer token gets `400 ambiguous_credentials`.
- Operations show `security: []` when public. `x-permission` names the permission-matrix entry the route checks; `x-recent-auth: true` means the session must have authenticated in the last 10 minutes (`403 reauth_required` otherwise).

## Request sizes and names

All requests have a 1 MB default body limit, including unknown endpoints. Upload routes explicitly raise it: receipts 10 MB, documents 20 MB, leave attachment JSON 36 MB (up to five separately checked 5 MB files), company-logo base64 JSON 1,500,000 bytes and employee import previews 10 MB. Oversized requests return 413 `file_too_large`. JSON Content-Type is checked before buffering the body. A module declares an upload exception using `maxBodyBytes` on its route; new routes keep the 1 MB default unless they explicitly opt in.

Name fields reject tabs, CR/LF and other control characters before schema trimming. Download filenames use an ASCII fallback and, where needed, an RFC 5987 UTF-8 `filename*` parameter. CSV text cells and headers use the shared formula-neutralising writer.
