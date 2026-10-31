## Purpose

Defines the platform behaviour every Crow HR module relies on: the API's health and error contract, input validation, the runtime-agnostic core, the database migration path, server configuration and hosting, and the web application shell.

## ADDED Requirements

### Requirement: Health endpoint
The API SHALL expose `GET /api/health` returning JSON with `status`, the application `version`, the current server `time` (ISO 8601, from the injected clock) and a `database` check result. It SHALL respond 200 with `status: "ok"` when the database answers a trivial query, and 503 with `status: "degraded"` and `database: "unreachable"` when it does not.

#### Scenario: Healthy database
- **WHEN** a client requests `GET /api/health` and the database is reachable
- **THEN** the response is 200 with `{ "status": "ok", "database": "ok" }` plus `version` and `time`

#### Scenario: Unreachable database
- **WHEN** a client requests `GET /api/health` and the database query fails
- **THEN** the response is 503 with `{ "status": "degraded", "database": "unreachable" }`

### Requirement: Error envelope
Every API error response SHALL be JSON of the form `{ "error": { "code", "message", "requestId", "details"? } }` with a stable machine-readable `code` (`validation_failed`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `internal`) and a matching HTTP status. Unexpected exceptions SHALL return `internal` with a generic message and SHALL NOT leak stack traces or exception text. Every response SHALL carry an `x-request-id` header that matches `requestId`.

#### Scenario: Unknown API route
- **WHEN** a client requests a path under `/api/` that has no handler
- **THEN** the response is 404 with `error.code` = `not_found`

#### Scenario: Unexpected exception
- **WHEN** a handler throws an error that is not an application error
- **THEN** the response is 500 with `error.code` = `internal`, a generic message, and the exception is logged server-side with the request id

### Requirement: Input validation
Request bodies, query strings and path parameters SHALL be validated against a declared schema before a handler runs. Invalid input SHALL be rejected with 400 `validation_failed`, and `details.issues` SHALL list each problem with its field `path` and a message that says how to fix it.

#### Scenario: Invalid body
- **WHEN** a client sends a body that fails the route's schema
- **THEN** the response is 400 with `error.code` = `validation_failed` and one issue per failing field, each naming the field path

### Requirement: Runtime-agnostic core
The core API package SHALL NOT import Node-only modules. Database, password hashing, file storage, clock, ID generation and logging SHALL be supplied by the host so the same API code can run in Node and in a browser.

#### Scenario: Core source scanned for Node built-ins
- **WHEN** the core package's source files are scanned for imports
- **THEN** none import a Node built-in module (with or without the `node:` prefix)

### Requirement: Database migration path
The schema SHALL be versioned as SQL migrations generated from the schema definition. Applying all migrations to an empty PostgreSQL-compatible database SHALL produce the `organisations` and `users` tables. Tests SHALL be able to obtain a fresh, migrated, in-process database without Docker.

#### Scenario: Fresh test database
- **WHEN** a test creates a test database
- **THEN** all migrations are applied and an organisation can be inserted and read back

### Requirement: Server configuration
The server SHALL read its configuration from environment variables, validate it at startup, and exit with a non-zero status and a message naming each invalid or missing variable when validation fails.

#### Scenario: Missing database URL
- **WHEN** the server starts without `DATABASE_URL`
- **THEN** it exits non-zero and prints that `DATABASE_URL` is required and what form it takes

### Requirement: Web app hosting
The server SHALL serve the built web application's static files and SHALL answer any non-API `GET` that matches no file with the application's `index.html`, so client-side routes survive a reload. API paths SHALL never fall back to `index.html`.

#### Scenario: Deep link reload
- **WHEN** a browser requests `/payroll` directly
- **THEN** the server returns the web app's `index.html` with status 200

#### Scenario: Unknown API path is not the SPA
- **WHEN** a client requests `/api/does-not-exist`
- **THEN** the response is the JSON 404 error envelope, not HTML

### Requirement: Application shell navigation
The web app SHALL present a shell with grouped navigation to Home, People, Payroll, Leave, Attendance, Schedules, Claims, Documents, Reports and Settings; a top bar with an organisation switcher, a command palette opened by ⌘K / Ctrl+K, and a user menu. On viewports narrower than 768px, admin navigation SHALL move into a drawer and the employee view SHALL show a bottom tab bar. The desktop sidebar SHALL collapse to an icon rail.

#### Scenario: Command palette jump
- **WHEN** the user presses ⌘K (or Ctrl+K), types "payroll" and presses Enter
- **THEN** the palette closes and the Payroll page is shown

#### Scenario: Narrow viewport
- **WHEN** the shell is rendered at 390px wide
- **THEN** the sidebar is hidden and navigation is reachable from a menu button (admin) or a bottom tab bar (employee view)

### Requirement: Honest placeholders
Modules that are not built yet SHALL render an empty state that names the module and states it is not available yet, never filler text. Any screen showing fixture data SHALL label it visibly as sample data. Unimplemented controls SHALL NOT pretend to succeed.

#### Scenario: Unbuilt module
- **WHEN** the user opens the Leave page
- **THEN** an empty state describes what Leave will do and states it is not available yet

#### Scenario: Fixture inbox
- **WHEN** the user opens Home
- **THEN** a visible notice states that the items shown are sample data

#### Scenario: Sign-in not wired
- **WHEN** the user submits the sign-in form
- **THEN** no request is made and the page states that sign-in is not available yet

### Requirement: Sign-in method presentation
The sign-in page SHALL render only the sign-in methods enabled for the organisation, chosen from email and password, Google Workspace, Microsoft Entra ID, Singpass and generic OpenID Connect. Provider buttons SHALL follow each provider's published button guidance for wording and colour. When staff password sign-in is disabled, the page SHALL still offer the organisation owner a password sign-in. Until authentication exists, choosing any method SHALL send nothing and SHALL state that the method is not available yet. The request context SHALL have room for how the session was established (`authMethod`) and the external identity behind it.

#### Scenario: Password only
- **WHEN** an organisation has only email and password enabled
- **THEN** the sign-in page shows the email and password form and no provider buttons

#### Scenario: All methods
- **WHEN** an organisation has every method enabled
- **THEN** the page shows Singpass, Google, Microsoft and single sign-on buttons above the email and password form, and the Singpass button is announced as "Log in with Sing-pass"

#### Scenario: SSO-only organisation
- **WHEN** staff password sign-in is disabled
- **THEN** the email form is hidden and an "Organisation owner? Sign in with password" link reveals it

#### Scenario: Sign-in methods settings placeholder
- **WHEN** the user opens Settings → Security → Sign-in methods
- **THEN** an empty state invites them to configure Google, Microsoft, Singpass or OIDC and states it is not available yet

### Requirement: Accessibility baseline
Interactive elements SHALL show a visible focus indicator for keyboard users, text SHALL meet WCAG AA contrast against its background, and the shell SHALL remain usable without horizontal scrolling at 360px width.

#### Scenario: Keyboard focus
- **WHEN** a keyboard user tabs through the top bar
- **THEN** each focused control shows a visible focus ring

#### Scenario: Smallest supported width
- **WHEN** the shell is rendered at 360px wide
- **THEN** the page does not scroll horizontally
