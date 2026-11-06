# Crow HR for iOS

SwiftUI app (Swift 6, iOS 27, bundle id `crowtech.crowhr`) for employee self-service and manager
approvals against a company's own Crow HR server. No third-party dependencies, no analytics, no
crash reporting, no remote push. Spec: `openspec/changes/add-mobile-apps/`.

## Build and test (on the `s5` Mac, from Linux)

```sh
scripts/ios-sync.sh                                     # rsync apps/ios + apps/mobile-fixtures to s5
ssh -F ~/.ssh/config s5 'cd ~/Developer/crowhr-ios && CROWHR_SIM_UDID=<udid> scripts/ios-mac-test.sh unit -only-testing:CrowHRTests'
bun run --cwd apps/web build                            # the server serves the sign-in page
CROWHR_SIM_UDID=<udid> scripts/ios-ui-test.sh           # seeded server + SSH reverse tunnel + XCUITests
CROWHR_UI_ONLY=CrowHRUITests/QAScreenshotsUITests CROWHR_SIM_UDID=<udid> scripts/ios-ui-test.sh   # QA only
scripts/ios-release.test.sh                             # release gate refusal paths (dry run)
```

`project.yml` is the source of truth; `CrowHR.xcodeproj` and `CrowHR/Info.plist` are generated on
the Mac by xcodegen and not committed. Tests use Crow HR's own simulator (`CrowHR · iPhone`) and
shut it down in a trap. Screenshots from the last UI run are in `artifacts/ios/`.

- **Unit tests** (`CrowHRTests`, Swift Testing) run every case in `apps/mobile-fixtures/`,
  shared with Android.
- **UI tests** (`CrowHRUITests`) sign in through the real ASWebAuthenticationSession against
  `e2e/seed.ts` + `scripts/ios-ui-seed.ts`, which adds a released payslip and a fictional logo.
- **Network allow-list:** two checks prove it, the app's own transport recorder and an `lsof`
  sampler of the app process on the Mac.
- **QA** (`QAScreenshotsUITests`) runs light XXXL, dark and dark XXXL with Xcode's accessibility
  audit. It checks element descriptions, clipped text and Dynamic Type.

## Server contract the app relies on

- **`/api/v1/meta`:**
  - API versions, and `features` to gate screens.
  - A server that lists none of `payslips`, `claims`, `scheduling`, `approvals` or
    `notifications` predates those flags, so the app assumes them present.
  - `organisations[].logoUrl` is shown only when it is on the server's own origin.
- **Native sign-in:** `/api/v1/native/{authorize,token,revoke}` with PKCE S256.
- **Punches:** `POST /api/v1/attendance/punches` with `source: "ios"`, the idempotency key and
  `queued`.
  - `elapsedMs` (monotonic time since the tap) is sent only when the phone hasn't restarted
    since the tap. The app checks this with the kernel boot session id.
  - The time-zone offset stays on the phone.
  - Punches the server refuses (for example, more than 7 days old) stay on Today with the
    server's reason until the user dismisses them.
- **Notifications:** `GET /api/v1/notifications` with the opaque `since` cursor. Servers without
  `cursor` fall back to the shared `createdAt` rules.

## Not done yet

- **App icon is a placeholder** (`scripts/ios-make-placeholder-icon.py`). It needs Daniel's
  approval before any release.
- Not in the app; these are done on the web:
  - leave types that need a child;
  - foreign-currency and multi-line claims;
  - the leave team calendar for managers.
- The QR scanner (AVFoundation) and Face ID are not exercised by tests, because the simulator has
  neither a camera nor biometrics. The camera is stubbed with `-uitest-camera-stub`, and dark mode
  is forced with `-uitest-dark` (both DEBUG and `-uitest` only).
- Release: `scripts/ios-release.sh` checks the approval record and plans the steps. The real
  archive and upload are not implemented, and the bundle id is not registered. The store listing
  draft is `store/app-store-metadata.md`.
