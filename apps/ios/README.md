# Crow HR for iOS

SwiftUI app (Swift 6, iOS 27, bundle id `crowtech.crowhr`, iPhone and iPad) for employee
self-service and manager approvals against a company's own Crow HR server. Version 1.0.0. No third-party dependencies, no analytics, no
crash reporting, no remote push. Spec: `openspec/changes/add-mobile-apps/`.

## Build and test (on a Mac over SSH, from Linux)

Set `CROWHR_MAC_HOST` to the Mac's SSH host (and `CROWHR_MAC_DIR` if its checkout is not
`~/Developer/crowhr-ios`). On the Mac, Xcode comes from `DEVELOPER_DIR` (default
`~/Applications/Xcode-27.1.app`).

```sh
scripts/ios-sync.sh                                     # rsync apps/ios + apps/mobile-fixtures to the Mac
ssh "$CROWHR_MAC_HOST" 'cd ~/Developer/crowhr-ios && CROWHR_SIM_UDID=<udid> scripts/ios-mac-test.sh unit -only-testing:CrowHRTests'
bun run --cwd apps/web build                            # the server serves the sign-in page
CROWHR_SIM_UDID=<udid> scripts/ios-ui-test.sh           # seeded server + SSH reverse tunnel + XCUITests
CROWHR_UI_ONLY=CrowHRUITests/QAScreenshotsUITests CROWHR_SIM_UDID=<udid> scripts/ios-ui-test.sh   # QA only
scripts/ios-release.test.sh                             # release gate refusal paths (dry run)
```

`project.yml` is the source of truth; `CrowHR.xcodeproj` and `CrowHR/Info.plist` are generated on
the Mac by xcodegen and not committed. Tests use Crow HR's own simulators, all on the iOS 27.0
runtime, and shut the one they use down in a trap. Screenshots from the last UI run are in
`artifacts/ios/`.

| Simulator | UDID | Device | For |
| --- | --- | --- | --- |
| `CrowHR · iPhone` | `D03C6B39-F769-4E90-804B-7B1F49DEAD15` | iPhone 18 Pro | tests |
| `CrowHR · Store 6.9` | `A6FA4CD6-6099-45A4-82BD-5E474E3BE983` | iPhone 17 Pro Max | 6.9-inch store screenshots, iPhone checks |
| `CrowHR · iPad 13` | `C9A4E466-2098-46A8-967A-9FD7851F9861` | iPad Pro 13-inch (M5) | iPad tests, 13-inch store screenshots (2064 x 2752) |
| `CrowHR · iPad 11` | `55A19629-76DE-46D8-9550-BD6F256139AC` | iPad Pro 11-inch (M5) | iPad layout tests |

Two agents can test at once from separate checkouts on the Mac: set `CROWHR_MAC_DIR` (for example
`Developer/crowhr-ios-ipad`) and `CROWHR_UI_PORT` (for example 3196) for the second, and use a
different simulator.

- **Unit tests** (`CrowHRTests`, Swift Testing) run every case in `apps/mobile-fixtures/`,
  shared with Android.
- **UI tests** (`CrowHRUITests`) sign in through the real ASWebAuthenticationSession against
  `e2e/seed.ts` + `scripts/ios-ui-seed.ts`, which adds a released payslip and a fictional logo.
- **Network allow-list:** two checks prove it, the app's own transport recorder and an `lsof`
  sampler of the app process on the Mac.
- **QA** (`QAScreenshotsUITests`) runs Xcode's accessibility audit (element descriptions,
  clipped text, Dynamic Type) on every screen of four tours:
  - an employee in light XXXL, dark and dark XXXL, from connecting to the server to Settings;
  - a manager in light XXXL: approvals, the decision sheet and notifications.

  A tour visits all its screens, then fails with every finding (`AUDIT FAIL` lines; per screen
  `AUDIT SCREEN`, per tour `AUDIT TOTAL`). Only Dynamic Type on system navigation-bar buttons, on
  iPadOS's floating tab bar (its titles are UIKit labels the audit reports without an element) and
  on text under the phone's floating tab bar is excused, and logged, with Settings' UI-test-only
  list of contacted servers. On an iPad at regular width the tour reaches Claims, Schedule, Profile
  and Settings as tabs; it is clean there too.
- **No `List` or `Form`.** The audit reports text in SwiftUI `List` and `Form` cells as not
  supporting Dynamic Type (and clipped) although it scales. So screens are `ScrollView`s built
  from `Design/Rows.swift` (`RowsScreen`, `RowGroup`, `ChoiceRow`, `FormField`, ...). Two more
  audit quirks shape the code:
  - A `Text` whose VoiceOver label differs from its text (a spoken amount) is reported as "may be
    clipped". Rows combine into one element and carry the spoken amount on the row (`AmountText`).
  - Azeret Mono draws "ft", "fi", "ff" and "fj" as one ligature glyph, which the audit also reports
    as clipped. Fixed UI text in Azeret Mono avoids them ("Save for later", "Use another server").
- `A11yAuditLabUITests` (DEBUG-only `A11yAuditLabView`) shows identical rows in a `List`, a `Form`
  and a `ScrollView` built from `Rows.swift`. It fails if the `ScrollView` variant gets any
  finding, and prints what the `List` and `Form` variants still get.
- **iPad layouts** (`IPadLayoutUITests`, skipped on an iPhone): both orientations, dark, XXXL, the
  compact width and the Command-key shortcuts, with assertions on the layout (see iPad below). The
  user-flow, QA and store classes also run on an iPad simulator.
- **Store screenshots** (`StoreScreenshotsUITests`) on the 6.9-inch and 13-inch simulators; see
  Release.

## iPad

The app is for iPhone and iPad (`TARGETED_DEVICE_FAMILY` '1,2'). An app can never drop iPad
support once a version has shipped with it, so the iPad layouts are designed, not stretched:

- **Navigation:** `TabView` with `.sidebarAdaptable`. At regular width iPadOS shows a sidebar in
  landscape and its floating tab bar in portrait (the user can switch with the sidebar button).
  Neither has More: the sidebar lists every screen (Today, Leave, Payslips, Inbox, Claims, Schedule,
  Profile, Settings) under the organisation and the signed-in person; the floating bar, which fits
  about six, has the first five and leaves Schedule, Profile and Settings to the sidebar
  (`.tabPlacement(.sidebarOnly)`). The tab set follows the width class (`MainTabView`), because the
  floating bar ignores `defaultVisibility(_:for:)` without tab customization.
- **Compact widths** (one-third Split View, Slide Over, a narrow Stage Manager window) get the
  phone's layout and tabs, with More. `TabRouting` moves a screen that only the wide layout lists
  under More (and back), so the selection never sits on a hidden tab.
- **Readable width** (`Design/Adaptive.swift`): `crowScreen()` centres content in a column about
  680 pt wide at the default text size (it grows with Dynamic Type), using horizontal safe-area
  padding, so lists, forms and scroll views keep full-width scrolling and backgrounds, sheets get
  their own width, and phone layouts get no padding at all. Connect and sign in are a 520 pt
  column, centred vertically.
- **Side by side:** Payslips is a `NavigationSplitView`: the list (plain rows, no `List`) beside
  the payslip (the latest opens first, the selected row is kuning-50). Where there isn't room
  (under 720 pt, such as a narrow Stage Manager window; at accessibility text sizes under
  1,200 pt) it collapses to the phone's list-then-payslip. Today puts the next shifts (up to six)
  beside the clock card when its column is at least 820 pt wide (a 13-inch iPad either way up).
- **Orientations and multitasking:** all four on iPad (`UISupportedInterfaceOrientations~ipad`), no
  `UIRequiresFullScreen`, so Split View, Slide Over and Stage Manager resizing work; one scene (a
  second window would share the signed-in state). The iPhone stays portrait only.
- **Sheets:** the payslip PDF opens page-sized, the server confirmation and the QR scanner
  form-sized.
- **Keyboard and pointer:** Command-key shortcuts (`GoShortcuts`; hold Command to list them):
  Command-1 to 6 for Today, Leave, Payslips, Inbox, Claims and Schedule, Command-7 for Profile and
  Command-comma for Settings (under More when the tab bar doesn't show them). Escape closes the app's own sheets; Return submits the server address and organisation
  ID. Under the pointer the primary button lifts onto a deeper hard shadow and secondary buttons
  shade; there are no soft hover effects.
- **Camera and biometrics:** the QR preview follows the interface orientation
  (`AVCaptureDevice.RotationCoordinator`). The receipt camera opens inside the form sheet, as
  Apple allows on iPad. The lock setting names the device's biometrics (Face ID on iPad Pro, Touch
  ID on other iPads), or offers the passcode alone.
- **Testing a compact width:** UI tests can't resize the window, so `-uitest-width <points>`
  (DEBUG and `-uitest` only) lays the app out in a strip that wide with the compact width class,
  as in a one-third Split View. Sheets still cover the whole window there.
- **Landscape screenshots:** on an iPad in landscape XCUITest's app screenshot keeps a portrait
  frame and crops, so `shot()` captures the screen and redraws it upright instead.
- **Sign-in browser:** on an iPad, `SafariViewService` left running by the previous test's sign-in
  could stop reporting idle, so every step of the next sign-in waited 60 s and timed out; iPad
  tests terminate it first.

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

## App icon

The Crow Tech crow standing on a kuning "HR" card, in the style of Crow Tech's other app icons.
`AppIcon-1024.png` is generated by `design/app-icon/make-app-icon.py` (see
`design/app-icon/README.md`); don't edit the PNG by hand.

## Not done yet

- Not in the app; these are done on the web:
  - leave types that need a child;
  - foreign-currency and multi-line claims;
  - the leave team calendar for managers.
- The QR scanner (AVFoundation), the receipt camera and Face ID or Touch ID are not exercised by
  tests, on iPhone or iPad, because the simulator has neither a camera nor biometrics. The camera
  is stubbed with `-uitest-camera-stub`, and dark mode is forced with `-uitest-dark` (both DEBUG
  and `-uitest` only).
- iPad: no build with iPad support has been uploaded yet (build 4 is iPhone only). Real Split View,
  Slide Over and Stage Manager resizing are not driven by tests (see "Testing a compact width").
  Approvals open as a sheet, not beside the list, and Apply for leave, New claim and the approval
  decision use the system's default form sheet, which in landscape on a 13-inch iPad leaves New
  claim's Submit button below the fold (it scrolls).
- Submitting for App Review is done by hand in App Store Connect, after the App Review details
  and the App Privacy answers.

## Release

Bundle id `crowtech.crowhr` is registered with Apple (`store/apple-resources.json`). Debug builds
are ad-hoc signed with no team; Release carries team `A8GBLXTNHB` and no entitlements. Signing
is Apple cloud signing with the team's App Store Connect API key, used in place on the Mac and
never copied: `APPLE_KEY_ID`, `APPLE_ISSUER_ID` and `APPLE_SIGNING_SECRET_DIR` (the directory on the
Mac with `AuthKey_<key id>.p8` and the build keychain) must be set for the release scripts:

```sh
CROWHR_BUILD_NUMBER=<n> scripts/ios-release.sh internal --approval <record>     # TestFlight internal only
CROWHR_BUILD_NUMBER=<n> scripts/ios-release.sh production --approval <record>   # App Store build
# The Mac steps it runs, usable alone for a dry rehearsal (no upload):
ssh "$CROWHR_MAC_HOST" 'cd ~/Developer/crowhr-ios && CROWHR_BUILD_NUMBER=<n> scripts/ios-archive-on-mac.sh'
ssh "$CROWHR_MAC_HOST" 'cd ~/Developer/crowhr-ios && CROWHR_BUILD_NUMBER=<n> CROWHR_INTERNAL_ONLY=1 \
  scripts/ios-export-on-mac.sh artifacts/CrowHR-build<n>.xcarchive artifacts/CrowHR-build<n>-export'
```

- `ios-archive-on-mac.sh` archives Release unsigned for a generic device with the given build number.
- `ios-export-on-mac.sh` has Apple cloud-sign it with the App Store Connect API key, using the
  dedicated build keychain and restoring the original keychain list afterwards. `ios-verify-ipa.py`
  then checks bundle id, version, build, iPhone and iPad (`UIDeviceFamily` [1, 2], the iPhone in
  portrait, the iPad in all four orientations, not full-screen only), Apple Distribution signature,
  team, `get-task-allow` false, no extra entitlements, an App Store profile,
  `PrivacyInfo.xcprivacy`, and an opaque 1024 px icon in `Assets.car`. It writes
  `verification.json` next to the IPA. `scripts/ios-verify-ipa.py --self-test` checks the device
  rules without an IPA.
- `ios-release.sh` then runs `altool --validate-app` and `altool --upload-app`, appends the build
  to `store/uploaded-builds.txt` and saves the IPA receipt, marked uploaded with altool's delivery
  id, as `store/build<n>-verification.json`. Never reuse a build number listed there.
- `internal` exports with "TestFlight internal testing only" set. `production` exports for App
  Store distribution (the flag absent; `ios-verify-ipa.py` checks it, and that
  `ITSAppUsesNonExemptEncryption` is false and the app is for iPhone and iPad). `production` also needs an
  approval record with `scope: production` and `build: <n>` matching `CROWHR_BUILD_NUMBER`. It
  uploads the build and stops: it never submits for review.
- Build 1 was archived, exported and verified on 7 Nov 2026 (`store/build1-verification.json`)
  but not uploaded (the App Store Connect app record didn't exist yet).
- **Build 2 (0.1.0) was uploaded on 7 Nov 2026** with Daniel's approval
  (`store/approvals/2026-11-07-testflight-internal-0.1.0.txt`): unit tests and the user-flow UI
  tests passed, the IPA checks passed (`store/build2-verification.json`), `altool` reported
  "VERIFY SUCCEEDED" and "UPLOAD SUCCEEDED" (delivery `8ebcb36b-6259-44e1-92e3-cee63d65cd83`).
  It is marked internal-only.
- **Build 4 (1.0.0) was uploaded for the App Store on 10 Nov 2026** with Daniel's approval
  (`store/approvals/2026-11-10-app-store-1.0.0.txt`, "Submit both") through
  `ios-release.sh production`: unit tests and the user-flow UI tests passed, the IPA checks passed
  (`store/build4-verification.json`, not internal-only), and altool reported "VERIFY
  SUCCEEDED" and "UPLOAD SUCCEEDED" (delivery `ccbbf84b-c37f-4b31-a657-d756bdf078be`). App Store
  Connect processed it (VALID), and `ios-store-listing.py attach-build 4` attached it to the 1.0.0
  version. Nothing has been submitted for review. Build 4 is iPhone only (`UIDeviceFamily` [1]): 1.0.0
  needs a new build with iPad support, approved and uploaded, attached in its place before review.
- The release gate runs the user-flow UI tests (`EssJourneyUITests`) on the iPhone simulator
  (`CROWHR_SIM_UDID`) and the iPad one (`CROWHR_IPAD_SIM_UDID`, required), not
  `QAScreenshotsUITests` (about 15 minutes). Run the QA audit by hand before a release, on both;
  task 3.7 stays open only for the manual VoiceOver and Dynamic Type pass on a real device.
- Internal TestFlight group **Crow HR Internal** (access to all builds) was created on 7 Nov 2026;
  the team's Account Holder was invited at Daniel's request. Add testers with
  `scripts/ios-store-register.py invite-internal EMAIL` on the Mac; internal testers must be
  App Store Connect users on the team. `testers` lists users, groups and tester states.

### App Store listing

`scripts/ios-store-listing.py` (on the Mac, same API key variables) fills what App Store
Connect's API allows from the approved copy in `store/app-store-metadata.md`:

```sh
ssh "$CROWHR_MAC_HOST" 'cd ~/Developer/crowhr-ios && APPLE_KEY_ID=… APPLE_ISSUER_ID=… APPLE_SIGNING_SECRET_DIR=… \
  /usr/bin/python3 scripts/ios-store-listing.py status|apply|screenshots [DIR]|attach-build <n>'
scripts/ios-store-listing.py check-screenshots   # offline, here or on the Mac: sets and sizes only
```

`apply` names the version 1.0.0 and sets the description, keywords, promotional text, subtitle,
support, marketing and privacy URLs, category (Business), copyright, the age rating answers (all
none or no) and the price (free, every territory). `screenshots` replaces the 6.9-inch iPhone
screenshots (`APP_IPHONE_67`) with `store/screenshots/*.png` and the 13-inch iPad ones
(`APP_IPAD_PRO_3GEN_129`) with `store/screenshots/ipad/*.png`, after checking every PNG's size
(iPhone 1320 x 2868 or 1290 x 2796, iPad 2064 x 2752 or 2048 x 2732, either orientation);
`attach-build` attaches a processed build. App Review contact and demo account, the App Privacy
answers and the submission stay in the web UI.

Store screenshots come from `StoreScreenshotsUITests` on Crow HR's own 6.9-inch simulator
(`CrowHR · Store 6.9`, iPhone 17 Pro Max, 1320 x 2868) with a 9:41 demo status bar:

```sh
CROWHR_SIM_UDID=<store simulator> CROWHR_UI_ONLY=CrowHRUITests/StoreScreenshotsUITests \
  CROWHR_UI_STORE_SEED=1 CROWHR_STATUS_BAR=demo scripts/ios-ui-test.sh
```

The 13-inch iPad set comes from the same class on `CrowHR · iPad 13` (iPad Pro 13-inch (M5),
2064 x 2752 portrait), with the same seed and status bar; copy its captures to
`store/screenshots/ipad/`:

```sh
CROWHR_SIM_UDID=C9A4E466-2098-46A8-967A-9FD7851F9861 CROWHR_UI_ONLY=CrowHRUITests/StoreScreenshotsUITests \
  CROWHR_UI_STORE_SEED=1 CROWHR_STATUS_BAR=demo scripts/ios-ui-test.sh
```

`CROWHR_UI_STORE_SEED=1` runs `scripts/ios-store-seed.ts`, which publishes Nurul's shifts through
the API so Today shows a schedule. The chosen captures are copied from `artifacts/ios/store-*.png`
to `store/screenshots/` (iPhone) or `store/screenshots/ipad/` (iPad).
