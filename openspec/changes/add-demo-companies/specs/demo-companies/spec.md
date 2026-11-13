## ADDED Requirements
### Requirement: Demo companies mode
A server SHALL offer demo companies only when started with `DEMO_COMPANIES=1`. Without it, every demo-company route SHALL answer 404, the try page SHALL show a not-found page, and no organisation SHALL be created with, or changed to have, a demo expiry.

#### Scenario: Off by default
- **WHEN** a server without `DEMO_COMPANIES` receives `POST /api/v1/demo-companies` or a persona sign-in for any organisation
- **THEN** it answers 404 and creates nothing

### Requirement: Private copy per visitor
`POST /api/v1/demo-companies` SHALL give the caller a new copy of the fictional sample company with a random short name (`demo-` + 12 base32 characters), unique fictional email addresses, no passwords, history dated relative to the day it was seeded, and an expiry (`DEMO_COMPANY_TTL_HOURS`, default 72, from the moment it is handed out). It SHALL answer with the server address, the short name, the `crowhr://connect` link and the expiry. Creation SHALL be limited per network (an IPv4 address, or an IPv6 /48) per hour and per day, on the whole server per hour, and by a maximum number of live copies; past a limit it SHALL answer 429 with when to try again. A start refused by a network's own limit SHALL NOT count against the whole server's.

#### Scenario: Two visitors
- **WHEN** two visitors each start a demo company
- **THEN** they get different short names, and nothing one does (a leave request, a claim, a payroll run) appears in the other's company

#### Scenario: Limit reached
- **WHEN** a network has started 5 demo companies in the last hour
- **THEN** the next start answers 429 and the try page says when to try again

#### Scenario: One address block
- **WHEN** clients from different /64s of the same IPv6 /48 have started 5 demo companies in the last hour
- **THEN** the next start from that /48 answers 429

#### Scenario: Server-wide limit reached
- **WHEN** the server has started 30 demo companies in the current clock hour, from any networks
- **THEN** the next start answers 429 with the end of that hour as the time to try again

### Requirement: Persona sign-in for a demo company
The sign-in page of a live demo company SHALL offer its people (owner, HR admin, payroll admin, manager, employees) as one-tap sign-in and SHALL NOT offer a password form or SSO. Persona sign-in SHALL work for the web and for the mobile apps' native sign-in (returning to the app with a one-time code), and SHALL be refused (404) for any organisation that is not a live demo company.

#### Scenario: Phone sign-in
- **WHEN** the Crow HR app opens a demo company's sign-in page and the visitor taps the employee
- **THEN** the app is signed in as that employee of that copy

#### Scenario: Real organisation on the same server
- **WHEN** a persona sign-in names a membership of an organisation without a demo expiry
- **THEN** the server answers 404 and no session or code is issued

#### Scenario: Expired copy
- **WHEN** a persona sign-in names a demo company past its expiry
- **THEN** the server answers 404 and the sign-in page says the demo company has ended, with a link to start a new one

### Requirement: Demo companies are not discoverable
The API SHALL NOT list demo companies. `GET /api/v1/meta` without `org` SHALL omit them; with a demo company's short name it SHALL answer `demo: true`.

#### Scenario: Listing
- **WHEN** a client calls `GET /api/v1/meta` on a server with live demo companies
- **THEN** none of their names or short names appear

### Requirement: Guard rails
In a demo company the server SHALL refuse changes to sign-in and security settings, SSO providers, member invitations, email addresses, passwords and MFA, and SHALL send no email. Uploads SHALL count against a per-company quota (default 25 MB) and be refused past it with a message naming the limit. Device sessions SHALL record the platform instead of the device's own name.

#### Scenario: Security settings
- **WHEN** the demo company's owner tries to change the sign-in methods
- **THEN** the server answers 403 "Not available in a demo company" and nothing changes

### Requirement: Expiry
The server SHALL delete each demo company after its expiry: every organisation-scoped row, its memberships, users who belong to no other organisation, its device sessions and its files. It SHALL never delete anything of an organisation without a demo expiry.

#### Scenario: Sweep
- **WHEN** the scheduler runs after a demo company has expired
- **THEN** the company, its people, its audit events and its uploaded files are gone, and every other organisation is unchanged

### Requirement: Try page
`/try` SHALL let a visitor get the app, start a demo company and open it in the app or in the browser: on a phone with an app link (on Android falling back to the Play listing), on a computer with a QR code of the connect link. It SHALL show the server address and company code to type instead, the expiry, and one sentence on what the demo server keeps, linking the privacy policy. Coming back SHALL show the visitor's current demo company until it expires.

#### Scenario: Computer, then phone
- **WHEN** a visitor starts a demo company on a computer and scans the QR code with the Crow HR app
- **THEN** the app connects to that same company, and what the employee submits on the phone appears for the manager in the browser
