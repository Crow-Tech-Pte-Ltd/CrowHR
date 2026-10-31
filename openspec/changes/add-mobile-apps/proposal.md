## Why

Shop-floor, F&B and field staff live on their phones, and QuickHR's mobile apps are where its public reviews are worst (2.7★ on the SG App Store, with clock-in failures and login glitches). A calm, reliable native app is a clear differentiator. Crow HR is self-hosted, so the app must work with *any* company's server and must not depend on a Crow Tech backend or collect data. This change is planning-only for milestone M4. It fixes the contract the server must keep (see `add-api-platform`) so mobile clients can arrive later without server rework.

## What Changes

- **Two native apps in this repo:** `apps/ios` (SwiftUI) and `apps/android` (Kotlin + Jetpack Compose), MIT, open source.
- **Connect to your server:**
  - Enter the server URL or scan a QR code shown in the web app (My profile → Mobile app).
  - The app checks `/api/v1/meta`, shows the organisation's name and logo, and refuses incompatible servers with a clear message.
  - Up to 5 saved servers and organisations.
- **Sign-in** uses whatever methods the server enables, through the system browser (ASWebAuthenticationSession / Custom Tabs) with PKCE via the native authorisation flow. Tokens are kept in Keychain / Android Keystore. Biometric unlock is optional.
- **Zero data collection.** The app makes network requests only to the configured server. There are no analytics, crash-reporting SDKs or third-party SDKs. Store privacy labels read "Data Not Collected".
- **Scope** is employee self-service plus manager approvals:
  - payslips (view, download or share on request);
  - leave (balances, apply, cancel, team calendar for managers);
  - claims with camera receipts;
  - my schedule;
  - clock-in with an offline-tolerant queue that the server validates;
  - approvals inbox;
  - notifications inbox.
- **Notifications without a Crow relay:** an in-app inbox, background refresh (iOS BGAppRefresh, Android WorkManager), and local notifications with content-free text. Remote push is an open question.
- **Build, test and publish** follow the Crow mobile workflow:
  - iOS builds and tests on the `s5` Mac over SSH; Android on Linux with the local SDK and the pinned Gradle wrapper.
  - Uploads go only to TestFlight internal or a Play internal draft.
  - Production release needs Daniel's explicit approval.
  - Privacy and support pages live at `crow.sg/apps/crow-hr/{privacy,support}`, kept out of crow.sg global navigation until launch.

## Capabilities

### New Capabilities
- `mobile-apps`: server connection, native sign-in and session storage, the privacy guarantees, the feature scope, the offline clock-in queue, notifications without remote push, compatibility with older servers, and the build and release process.

### Modified Capabilities
None. Server-side contracts live in `api-platform`, and attendance clock-in validation will live in the attendance change (M2).

## Non-goals

- Admin and HR features in the apps: payroll runs, employee editing, settings.
- Kiosk mode, face-recognition clock-in, NFC and biometric hardware.
- Tablets as a designed target (they work as scaled phone layouts), and watch apps.
- Remote push through a Crow-operated relay (needs a separate opt-in decision), and any Crow-hosted backend.
- A white-label or per-company build, and MDM or managed app configuration (P2).
- F-Droid or other alternative stores (P2).
- Writing code in this change. All tasks are for M4.

## Impact

- New `apps/ios` and `apps/android` (M4). New scripts `scripts/ios-*.sh` and `scripts/android-build.sh` that mirror the Gremia workflow.
- Server dependencies, all specified elsewhere: `/api/v1` stability, `/api/v1/meta`, native auth and device sessions (`add-api-platform`); attendance punch validation with idempotency keys (attendance change, M2); notifications `since` cursor (`add-approvals-and-notifications`).
- Web: My profile → Mobile app QR page.
- crow-tech-landing repo: `app/apps/crow-hr/privacy` and `support` pages (owner approval before publishing).
