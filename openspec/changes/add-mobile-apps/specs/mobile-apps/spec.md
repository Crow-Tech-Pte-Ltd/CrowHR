## Purpose

Defines the native iOS and Android apps that let employees and managers use their own company's self-hosted Crow HR server from a phone, without any Crow Tech backend and without data collection.

## ADDED Requirements

### Requirement: Connect to a company server
On first launch the app SHALL offer "Enter server address" and "Scan QR code". The QR code shown in the web app (My profile → Mobile app) SHALL encode `crowhr://connect?server=<PUBLIC_URL>&org=<slug>` and SHALL contain no credentials. The app SHALL call `<server>/api/v1/meta`, show the organisation name and logo, and ask the user to confirm. It SHALL require HTTPS. Plain HTTP SHALL be allowed only for private-range IP addresses and `.local` hosts, after a warning that the connection is not encrypted. If the server supports no API version the app understands, the app SHALL say whether the server or the app needs updating. Up to 5 connections SHALL be saved and switchable.

#### Scenario: Old server
- **WHEN** the app needs API feature `leave.v1` and the server's meta does not list it
- **THEN** the leave tab is hidden and Settings shows "Your company's Crow HR server is older than this app. Leave is available after your administrator upgrades"

#### Scenario: Not a Crow HR server
- **WHEN** the entered URL returns HTML without a valid meta response
- **THEN** the app says it could not find Crow HR at that address and suggests checking the address with HR

### Requirement: Native sign-in and session storage
Sign-in SHALL open the server's native authorisation endpoint in the system browser session (ASWebAuthenticationSession on iOS, Custom Tabs on Android), never an embedded web view. It SHALL use PKCE S256 and a random `state`. Access and refresh tokens SHALL be stored only in the iOS Keychain (this-device-only, after first unlock) or encrypted with an Android Keystore key, and SHALL be excluded from device and cloud backups. Users SHALL be able to turn on biometric unlock, after which the app SHALL require Face ID / Touch ID / BiometricPrompt (with device passcode fallback) when it returns from more than 5 minutes in the background. Signing out SHALL revoke the device session on the server and delete local data.

#### Scenario: SSO-only organisation
- **WHEN** the organisation enables only Microsoft Entra ID
- **THEN** the app's sign-in opens the system browser at the organisation's sign-in page, the user signs in with Microsoft, and the app receives tokens without seeing the password

#### Scenario: Revoked on the web
- **WHEN** the device session is revoked from the web app
- **THEN** the next app request gets 401, and the app clears its local data and returns to sign-in

### Requirement: Zero data collection
The apps SHALL make network requests only to the configured Crow HR server, plus the identity provider pages opened in the system browser. They SHALL include no analytics, crash reporting, advertising or other third-party SDKs that transmit data. The App Store privacy label SHALL be "Data Not Collected" and the Play Data safety form SHALL declare no data collected or shared by the developer, after an audit of all transitive dependencies. Cached data (payslip list, leave balances, schedule, queued punches) SHALL be stored encrypted on the device and deleted on sign-out. The app switcher snapshot SHALL be obscured. On Android, screens showing payslips SHALL set `FLAG_SECURE`.

#### Scenario: Network allow-list test
- **WHEN** the UI test suite runs a full ESS journey against a test server while recording all outbound connections
- **THEN** every connection goes to the test server's host

### Requirement: Feature scope
The apps SHALL provide, subject to the member's permissions from the server and to the server's enabled features:
- payslips: list, view, and download/share a PDF only on explicit action;
- leave: balances, apply (full or half day, attachment from camera or files), withdraw or cancel, own history, team calendar for managers;
- claims: multi-line, camera receipts, foreign currency with rate, draft saving;
- my published schedule;
- clock in/out;
- approvals inbox with approve and reject (comment required);
- notifications inbox;
- read-only profile.

Each screen SHALL have loading, empty, error and offline states. Text SHALL scale to 200% without truncating actions. All controls SHALL have accessibility labels. Light and dark themes SHALL follow the system, using Crow Tech tokens and Azeret Mono for numbers.

#### Scenario: Manager approves on phone
- **WHEN** a manager opens a pending leave task in the app and rejects it without a comment
- **THEN** the app asks for a comment before sending, as the web does

### Requirement: Offline clock-in queue
A clock-in or clock-out tapped while offline, or while the server is unreachable, SHALL be queued on the device with: a client-generated idempotency key, device wall-clock time, monotonic time since boot, time-zone offset, and the location and accuracy radius when the organisation's attendance policy asks for location and the user granted permission. Queued punches SHALL be sent in order when connectivity returns. The server's decision (accepted, flagged with reason, or rejected with reason) SHALL be shown per punch. The queue SHALL hold up to 200 punches. A punch older than 7 days SHALL still be sent; the server refuses it (attendance spec), and the app SHALL keep it visible with the server's reason ("ask your manager to add it to your timesheet") until the user dismisses it. Native apps SHALL send the monotonic elapsed time since the tap (`elapsedMs`) when the device has not restarted, so the server records the real tap time even if the clock was changed. The app SHALL never alter or drop a queued punch silently.

#### Scenario: Punch in a basement
- **WHEN** an employee clocks in with no signal at 08:58 and connectivity returns at 09:20
- **THEN** the punch is submitted at 09:20 with a recorded time of 08:58, and the app shows "Synced" or the server's flag reason

#### Scenario: Duplicate send
- **WHEN** the network drops after the server stored a punch but before the app received the response, and the app retries
- **THEN** the server returns the original result for the same idempotency key, and only one punch exists

### Requirement: Notifications without remote push
The apps SHALL show the server's notifications inbox. They SHALL refresh it in the background using the platform scheduler (no more often than the OS allows; Android at most every 15 minutes) and when the app opens. For new items they SHALL post a local notification whose text contains no personal data, such as "You have 2 new items in Crow HR". Users SHALL be able to turn local notifications off. Remote push SHALL NOT be implemented without a separate approved change.

#### Scenario: New approval while app closed
- **WHEN** a leave task is assigned to a manager and the OS later runs a background refresh
- **THEN** a local notification "You have 1 new item in Crow HR" appears, and tapping it opens the approvals inbox

### Requirement: Build, test and release process
iOS SHALL be built and tested on the authorised Mac (over SSH, `CROWHR_MAC_HOST`) from a permanent checkout synced from this repo. Android SHALL be built on Linux with the local Android SDK, a pinned and checksummed Gradle wrapper, and the project's own emulator, using stable toolchain versions verified from official sources at implementation time. Each platform SHALL have unit tests and UI tests that run against a local Crow HR server seeded with fictional data. Credentials SHALL be referenced only by path and never committed or printed. Without a production approval, builds SHALL be uploaded only to TestFlight internal testing or a Google Play internal draft. Any production upload, submission or publication SHALL require Daniel's explicit written approval, recorded in an approval record that names the version and build the release scripts check. Privacy and support pages SHALL exist at `https://crow.sg/apps/crow-hr/privacy/` and `/support/` before any store submission, and SHALL stay out of crow.sg global navigation until launch.

#### Scenario: Release attempt without approval
- **WHEN** a build is ready and no written approval from Daniel exists for production
- **THEN** the release scripts upload only to internal testing tracks, and the production command refuses to run without an explicit approval flag referencing the approval record
