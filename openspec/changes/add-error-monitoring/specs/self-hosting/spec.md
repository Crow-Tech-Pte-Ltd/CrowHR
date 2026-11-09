## ADDED Requirements

### Requirement: Optional error monitoring
The app SHALL report to a Sentry-compatible service only when the operator sets `SENTRY_DSN` (server) or `SENTRY_BROWSER_DSN` (browser). Without them it SHALL load no monitoring SDK and make no monitoring requests. Events SHALL NOT contain request or response bodies, cookies, query strings, IP addresses, user details, database query values or stack-frame variables. Expected failures (`AppError`, HTTP 4xx) SHALL NOT be reported. The browser DSN SHALL be delivered at runtime, never built into the image. Invalid monitoring variables SHALL stop startup with a message naming the variable, without echoing a DSN.

#### Scenario: Default install
- **WHEN** neither DSN is set
- **THEN** no SDK is imported, the page has no monitoring settings and its CSP `connect-src` is `'self'`

#### Scenario: Server error
- **WHEN** `SENTRY_DSN` is set and a request with a JSON body, a session cookie and a query string fails with an unexpected error
- **THEN** one issue is sent with the route, method and request ID, and without the body, cookie or query string

#### Scenario: Browser reporting
- **WHEN** `SENTRY_BROWSER_DSN=https://key@glitchtip.example.sg/2` is set and the app restarted
- **THEN** every `index.html` response carries the settings and its CSP `connect-src` includes `https://glitchtip.example.sg`
