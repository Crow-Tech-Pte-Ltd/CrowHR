---
title: API conventions
description: Versioning and compatibility rules, request and response conventions, lists, errors and authentication for the Crow HR REST API.
---

The web app, the planned native apps and integrations all use the same versioned REST API. The contract is generated from the route declarations in `packages/core`, served by a running server at `GET /api/v1/openapi.json`, committed as `packages/core/openapi/v1.snapshot.json` and rendered in the [API reference](/docs/api/).

## Versions and compatibility

- Every application endpoint is under `/api/v1/`. `GET /api/health` stays unversioned.
- **Within v1, changes are additive only**: new endpoints, new optional request fields or query parameters, new response fields, and new enum values only where the schema sets `x-extensible-enum: true`.
- **Breaking changes need `/api/v2`**: removing or renaming an endpoint or field, making an optional input required, adding a required input, changing a field's type or meaning, removing an enum value, adding a value to a closed response enum, or tightening validation.
- After `/api/v2` ships, `/api/v1` is served for **at least 12 months**.
- A deprecated endpoint still answers and adds `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers.
- An unsupported version (`/api/v9/...`) answers `404 not_found` with `details.supportedVersions`.

`bun run check` fails when the committed snapshot differs from what the code generates, or when it has breaking changes against the newest released snapshot.

## Requests and responses

| Topic | Convention |
| --- | --- |
| Bodies | JSON only (`Content-Type: application/json`), camelCase field names. |
| IDs | UUIDv7 strings. |
| Money | Integer cents, `…Cents` suffix (`basicPayCents: 450000`). Never floats. |
| Dates | `YYYY-MM-DD` for calendar dates (Singapore local); ISO 8601 UTC for instants. |
| Sensitive fields | Marked `x-sensitivity: salary`, `nric`, `bank` or `medical`. Omitted for readers without access and listed in `redactedFields`. NRIC/FIN is masked unless revealed through the dedicated endpoint. |
| Unknown fields | Responses never contain undeclared fields. |

## Lists

```
GET /api/v1/members?page=2&pageSize=50&sort=-createdAt&q=tan&status=active,invited
200 { "items": [...], "page": 2, "pageSize": 50, "total": 132 }
```

- `page` is 1-based; `pageSize` defaults to 50, maximum 200.
- `sort` names one declared field; prefix `-` for descending. The ID is always the tiebreaker.
- `q` is free-text search where the endpoint supports it.
- Filters are query parameters named after the field; multi-value filters are comma-separated; date ranges are `<field>From` / `<field>To`, inclusive.

### New notifications since a cursor

`GET /api/v1/notifications` also returns `cursor`, an opaque string for the newest notification in the response's view (`null` when you have none). Send it back as `since` to get only newer notifications, oldest first:

```
GET /api/v1/notifications?since=bjEuMTc5...&pageSize=50
200 { "items": [...], "total": 2, "unread": 5, "cursor": "bjEuMTc5..." }
```

With `since`, `cursor` points at the last item returned, so keep calling with the new cursor until `items` is empty. The cursor doesn't move when nothing is new or when you read items. A cursor the server didn't issue answers `400 validation_failed`. The mobile apps use this for background refresh.

## Errors

```json
{ "error": { "code": "validation_failed", "message": "Some fields need attention.", "requestId": "…",
  "details": { "issues": [{ "path": "email", "message": "Enter a valid email address, like name@company.sg." }] } } }
```

Switch on `code`, never on `message`. Each operation lists its codes under `x-error-codes`. Common codes:

| Status | Codes |
| --- | --- |
| 400 | `validation_failed`, `ambiguous_credentials`, `invalid_grant` |
| 401 | `unauthenticated`, `invalid_credentials`, `invalid_mfa_code`, `invalid_setup_code`, `session_expired`, `session_revoked` |
| 403 | `forbidden`, `csrf_rejected`, `reauth_required`, `mfa_enrolment_required`, `password_sign_in_disabled`, `self_change_requires_approval`, `disabled_in_demo` |
| 404 | `not_found`, also for records outside your organisation or scope |
| 409 | `conflict`, `last_owner`, `setup_required`, `duplicate_id_number`, `in_use`, `reporting_cycle`, `already_decided` |
| 429 | `rate_limited`, with `Retry-After` |
| 5xx | `internal` (500, details are only in the server log), `not_implemented` (501), `service_unavailable` (503, for example while starting or restoring) |

## Authentication

- **Browser**: an HttpOnly session cookie (`__Host-crowhr_session`, or `crowhr_session` when `PUBLIC_URL` is plain http). State-changing requests must be same-origin, or they get `403 csrf_rejected`.
- **Native apps**: `Authorization: Bearer <access token>` from the native authorisation-code + PKCE flow (access tokens last 15 minutes). Tokens are never accepted in query strings, and a request with both a cookie and a bearer token gets `400 ambiguous_credentials`.
- There are no API keys for server-to-server integrations yet.
- In the OpenAPI document, `security: []` marks public operations, `x-permission` names the permission checked and `x-recent-auth: true` means the session must have authenticated in the last 10 minutes.
