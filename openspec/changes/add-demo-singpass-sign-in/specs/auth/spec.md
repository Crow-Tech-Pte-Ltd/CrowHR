## MODIFIED Requirements
### Requirement: Demo-mode sign-in
When the core runs in demo mode, Google, Microsoft and generic OIDC buttons SHALL be visible on the sign-in page, disabled, and labelled as not available in the demo. The Singpass button SHALL work when the demo build is configured with a Singpass start URL (otherwise it is disabled like the others): it SHALL send the visitor through a real Singpass login on a configured Crow HR server and, on return, offer "Continue as HR admin" or "Continue as Employee". Password sign-in SHALL work against seeded fictional accounts, and the sign-in page SHALL offer one-click persona selection (owner, HR admin, payroll admin, manager, employee). Demo password hashes SHALL use a format the production hasher rejects.

#### Scenario: SSO in demo
- **WHEN** a demo visitor clicks the Microsoft button
- **THEN** no network request is made to any identity provider and the explanation is shown

#### Scenario: Singpass in the demo
- **WHEN** a demo visitor logs in with Singpass and comes back with `singpass=ok`
- **THEN** the page offers HR admin and Employee, and choosing one signs in as that seeded persona in the visitor's own demo copy

## ADDED Requirements
### Requirement: Demo Singpass round trip
A server configured with `DEMO_SINGPASS_PROVIDER_ID` and `DEMO_SINGPASS_RETURN_URL` SHALL accept `purpose=demo` on that Singpass provider's start route without a session. The callback SHALL validate Singpass's answer like any sign-in and then SHALL NOT create a session, link, identity or invitation record, and SHALL NOT store the subject; it SHALL redirect to the configured return URL with `singpass=ok`, or `singpass=failed` on any failure. Any other provider, a non-Singpass provider, or an unconfigured server SHALL answer 404. Starts SHALL be limited per network per hour and overall per day.

#### Scenario: Identity discarded
- **WHEN** a visitor completes the demo round trip
- **THEN** they are redirected to the return URL with `singpass=ok`, no session cookie is set and no row anywhere contains their Singpass subject

#### Scenario: Not configured
- **WHEN** `purpose=demo` is used on a server without the demo settings, or on another provider
- **THEN** the answer is 404

### Requirement: Official Singpass logo
When the deployer supplies the official Singpass logo (server: `branding/singpass-logo.svg` or `.png` in the data directory; demo: `VITE_SINGPASS_LOGO_SRC`), the Singpass button SHALL show it. The repository SHALL NOT contain Singpass artwork.

#### Scenario: Logo present
- **WHEN** the file exists
- **THEN** the sign-in methods response carries its URL, the button shows it, and the file is served with `X-Content-Type-Options: nosniff` and a sandboxing Content-Security-Policy
