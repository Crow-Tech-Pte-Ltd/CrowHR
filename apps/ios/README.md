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
scripts/ios-release.test.sh                             # release gate refusal paths (dry run)
```

`project.yml` is the source of truth; `CrowHR.xcodeproj` and `CrowHR/Info.plist` are generated on
the Mac by xcodegen and not committed. Tests use Crow HR's own simulator (`CrowHR · iPhone`) and
shut it down in a trap.

- Unit tests (`CrowHRTests`, Swift Testing) run every case in `apps/mobile-fixtures/`, shared
  with Android.
- UI tests (`CrowHRUITests`) sign in through the real ASWebAuthenticationSession against
  `e2e/seed.ts` + `scripts/ios-ui-seed.ts`. Two checks prove the network allow-list: the app's
  own transport recorder, and an `lsof` sampler of the app process on the Mac.

## Not done yet

- **App icon is a placeholder** (`scripts/ios-make-placeholder-icon.py`). It needs Daniel's
  approval before any release.
- Not in the app; these are done on the web:
  - leave types that need a child;
  - foreign-currency and multi-line claims;
  - the leave team calendar for managers;
  - payslip PDF download outside the share sheet.
- The QR scanner (AVFoundation) and Face ID are not exercised by tests, because the simulator has
  neither a camera nor biometrics. The camera is stubbed with `-uitest-camera-stub` (DEBUG only).
- Release: `scripts/ios-release.sh` checks the approval record and plans the steps. The real
  archive and upload are not implemented, and the bundle id is not registered.
