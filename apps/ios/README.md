# Crow HR for iOS

SwiftUI app (Swift 6, iOS 27, bundle id `crowtech.crowhr`, iPhone and iPad) for employee
self-service and manager approvals against a company's own Crow HR server. No third-party
dependencies, no analytics, no crash reporting, no remote push. Spec: `openspec/changes/add-mobile-apps/`.
The version is `MARKETING_VERSION` in `project.yml`; the build number is set at release
(`CROWHR_BUILD_NUMBER`).

## What it does

- **Today:** clock in and out (an offline queue keeps punches on the phone until they are sent),
  and the next shifts.
- **Leave:** balances (per-child ones name the child), my requests with Withdraw and Cancel, and
  Apply with the live quote, half days, a photo attachment and, for the types that must name one
  (maternity, paternity, shared parental, adoption, unpaid infant care), the child. The Calendar
  segment lists two weeks of who is away by day: the team view for owners, HR and managers
  ("My team", or "Everyone"), "Who's away" for everyone; a row opens the request.
- **Payslips:** released payslips and their PDF (never cached on the phone).
- **Inbox:** approvals (approve, or reject with a comment) and notifications. Tapping a
  notification opens what it is about; the tab's badge counts unread notifications.
- **Claims:** my claims, each on its own screen (lines with foreign amounts and rates, payout,
  submit a saved draft, withdraw, delete a draft), and New claim: up to 30 expenses, each in any
  of the web form's currencies with the rate to SGD and the SGD amount, and a camera receipt where
  the type needs one.
- **Schedule:** the next 14 days; Swap on an upcoming shift (swap it for a colleague's shift on
  the same roster, or give it away), offers from colleagues to accept or decline, open shifts to
  pick up, and my requests with their status (cancel while pending).
- **Profile** (read-only) and **Settings** (connections, app lock, notifications).

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
runtime, and shut the one they use down in a trap. Find a simulator's UDID with
`xcrun simctl list devices | grep CrowHR`. Screenshots from the last UI run are in `artifacts/ios/`.

| Simulator | Device | For |
| --- | --- | --- |
| `CrowHR · iPhone` | iPhone 18 Pro | tests |
| `CrowHR · Store 6.9` | iPhone 17 Pro Max | 6.9-inch store screenshots, iPhone checks |
| `CrowHR · iPad 13` | iPad Pro 13-inch (M5) | iPad tests, 13-inch store screenshots (2064 x 2752) |
| `CrowHR · iPad 11` | iPad Pro 11-inch (M5) | iPad layout tests |

Two runs can share the Mac from separate checkouts: set `CROWHR_MAC_DIR` (for example
`Developer/crowhr-ios-ipad`) and `CROWHR_UI_PORT` (for example 3196) for the second, and use a
different simulator.

- **Unit tests** (`CrowHRTests`, Swift Testing) run every case in `apps/mobile-fixtures/`,
  shared with Android, among them the claim money rules (`claim-money-cases.json`) and where a
  notification's link opens (`notification-link-cases.json`).
- **UI tests** (`CrowHRUITests`) sign in through the real ASWebAuthenticationSession against
  `e2e/seed.ts` + `scripts/ios-ui-seed.ts`, which adds a released payslip and a fictional logo.
  `TestServerSeed` adds the rest from the test runner through the server's API, as a second
  device session: next week's published roster with an open shift, a pending swap offer, a child
  for unpaid infant care leave and a draft claim in two currencies. It reuses what exists, so the
  tests run in any order. `EssJourneyUITests` covers, besides clocking in offline, leave, a claim,
  the payslip and approvals: a claim with an SGD and a ringgit expense and its own screen, a swap
  offer and an open-shift pickup, accepting an offer opened from its notification, leave that
  names a child, the team calendar, and a task opened from its notification.
- **Network allow-list:** two checks prove it, the app's own transport recorder and an `lsof`
  sampler of the app process on the Mac.
- **QA** (`QAScreenshotsUITests`) runs Xcode's accessibility audit (element descriptions,
  clipped text, Dynamic Type) on every screen of four tours:
  - an employee in light XXXL, dark and dark XXXL, from connecting to the server to Settings:
    Today, Leave (with a pending request), New leave (also with a type that needs a child),
    the leave calendar, Payslips, a payslip, Inbox, More, Claims, New claim (one expense, then
    two with a foreign currency, and the claim-type list at XXXL), a claim's screen, My schedule,
    the Swap sheet, My profile, Settings and the font licences;
  - a manager in light XXXL: approvals, the decision, notifications, the team calendar and a
    leave request opened from it.

  A tour visits all its screens, then fails with every finding (`AUDIT FAIL` lines; per screen
  `AUDIT SCREEN`, per tour `AUDIT TOTAL`). Only Dynamic Type on system navigation-bar buttons, on
  iPadOS's floating tab bar (its titles are UIKit labels the audit reports without an element) and
  on text under the phone's floating tab bar is excused, and logged, with Settings' UI-test-only
  list of contacted servers. On an iPad at regular width the tour reaches Claims, Schedule, Profile
  and Settings as tabs.
- **No `List` or `Form`.** The audit reports text in SwiftUI `List` and `Form` cells as not
  supporting Dynamic Type (and clipped) although it scales. So screens are `ScrollView`s built
  from `Design/Rows.swift` (`RowsScreen`, `RowGroup`, `ChoiceRow`, `FormField`, ...). Two more
  audit quirks shape the code:
  - A `Text` whose VoiceOver label differs from its text (a spoken amount) is reported as "may be
    clipped". Rows combine into one element and carry the spoken amount on the row (`AmountText`).
  - Azeret Mono draws "ft", "fi", "ff" and "fj" as one ligature glyph, which the audit also reports
    as clipped. Fixed UI text in Azeret Mono avoids them in lower case ("Save for later", "Use
    another server"; the offer sheet is titled "Swap"). Section labels are upper case, which is fine.
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
  column, centred vertically. The leave calendar is a day-by-day list in that column, as the web
  shows it on a phone.
- **Side by side:** Payslips is a `NavigationSplitView`: the list (plain rows, no `List`) beside
  the payslip (the latest opens first, the selected row is kuning-50). Where there isn't room
  (under 720 pt, such as a narrow Stage Manager window; at accessibility text sizes under
  1,200 pt) it collapses to the phone's list-then-payslip. Approvals follow the same rule: the
  list beside the chosen request's decision (the first one open at first, the next one after each
  decision), a sheet where there isn't room. Today puts the next shifts (up to six) beside the
  clock card when its column is at least 820 pt wide (a 13-inch iPad either way up).
- **Orientations and multitasking:** all four on iPad (`UISupportedInterfaceOrientations~ipad`), no
  `UIRequiresFullScreen`, so Split View, Slide Over and Stage Manager resizing work; one scene (a
  second window would share the signed-in state). The iPhone stays portrait only.
- **Sheets:** the payslip PDF, Apply for leave and New claim open page-sized (so New claim's
  Submit button is on screen); the server confirmation, the QR scanner, the Swap sheet, a leave
  request and the decision (where it isn't beside the list) form-sized.
- **Keyboard and pointer:** Command-key shortcuts (`GoShortcuts`; hold Command to list them):
  Command-1 to 8 for Today, Leave, Payslips, Inbox, Claims, Schedule, Profile and Settings, under
  More when the tab bar doesn't show the screen. Not Command-comma: iPadOS keeps that for the
  app's page in the Settings app. Escape closes the app's own sheets; Return submits the server
  address and organisation ID. Under the pointer the primary button lifts onto a deeper hard
  shadow and secondary buttons shade; there are no soft hover effects.
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
  - API versions, and `features` to gate screens (`leave`, `payslips`, `claims`, `scheduling`,
    `approvals`, `notifications`, `attendance.offlinePunch`). The leave calendar and children
    belong to `leave`, swaps and open shifts to `scheduling`; every `/api/v1` server has their
    endpoints, so there are no finer flags. A notification for a screen the server has switched
    off opens the notifications inbox instead.
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
  `cursor` fall back to the shared `createdAt` rules. Only signing in marks the inbox seen (a cold
  start can be iOS launching the app for a background refresh).
  - Each item's `link` (a path on the server, such as `/inbox?task=<id>` or `/leave?request=<id>`)
    says what it is about (`AppTarget`, `notification-link-cases.json`). Tapping it in the inbox
    marks it read (`POST /api/v1/notifications/{id}/read`) and opens that item; a link the app has
    no screen for (documents, people, payroll) only marks it read.
  - The local notification's text is a count only. When it announces one new item, that item's
    link and id ride in its `userInfo` (never shown), so tapping it opens the item and marks it
    read; with several it opens the approvals or notifications inbox.
  - The Inbox tab's badge is `GET /api/v1/notifications/unread-count` (and the list's `unread`),
    refreshed on sign-in, on return to the app and after a background refresh. The app icon shows
    the same count while notifications are on.
- **Approvals:** the decision shows the request's `summary` (lines and context) and comments from
  `GET /api/v1/approvals/requests/{id}`, as the web and Android do. A 409 `already_decided` (or a
  404) refreshes the list. The Approvals segment shows for owners, HR and payroll admins and
  managers, and for anyone `GET /api/v1/approvals/tasks` has tasks for (a reporting-line manager
  without the role, a named approver, out-of-office cover). A notification about a task that no
  longer waits says so above the list.
- **Sessions:** a refresh ends the session only when the server answers a 4xx with its own error
  envelope (`invalid_grant`); a certificate error, an unreadable reply or a proxy's error page keeps
  the tokens. With the lock on, the app asks on every cold start and after more than 5 minutes in
  the background, as on Android.
- **Errors:** the envelope's `message` is shown as it is; when `details.issues` has several
  problems (the message then only counts them) each issue's message follows on its own line.
- **Leave:**
  - "My leave" always passes `employeeId` (from `/me`, waited for): without it the list endpoint
    returns everything the caller may see. A sign-in without an employee record gets an
    explanation instead.
  - A type with `needsChild` sends `childId` (from `GET /api/v1/leave/children`) to
    `POST /api/v1/leave/quote` and `POST /api/v1/leave/requests`; other types send none. The
    quote's issue with `path: "childId"` shows under the Child field, its other issues under
    "Days counted", so the messages are the server's, as on the web. Children are added on the web.
  - The calendar is `GET /api/v1/leave/calendar?from&to&view=team|org`, two weeks from a Monday.
    The team view is offered when `/me` `permissions["leave:read"]` includes `team` or `all`. A
    row's `requestId` opens `GET /api/v1/leave/requests/{id}`.
- **Claims:**
  - `POST /api/v1/claims` with one line per expense: `currency`, `amountMinor` in that currency's
    minor units and, for anything but SGD, `rate` as typed (SGD per 1 unit, at most 6 decimals).
    The SGD preview and total use the server's rule (integers, one half-up rounding per line;
    `ClaimMoney`), and a type's receipt rule applies to the SGD amount. Each receipt is uploaded
    first (`POST /api/v1/claims/receipts`) and reused if the claim has to be sent again.
  - A claim's screen is `GET /api/v1/claims/{id}`; its `actions` decide Submit
    (`POST …/submit`), Withdraw (`POST …/withdraw`) and Delete (`DELETE`, drafts only).
- **Schedule:** `GET /api/v1/scheduling/me` (shifts with `rosterId` and `pendingSwap`, `weeks`,
  `openShifts`, `swaps`; lists a server doesn't send count as empty, and every week as published).
  Offering a shift reads its roster, `GET /api/v1/scheduling/rosters/{id}`, for the colleagues and
  their upcoming shifts. `POST /api/v1/scheduling/swaps` sends a `swap`, `giveaway` or `pickup`;
  `POST /api/v1/scheduling/swaps/{id}/accept|decline|cancel` answers or withdraws one.

## App icon

The Crow Tech crow standing on a kuning "HR" card, in the style of Crow Tech's other app icons.
`AppIcon-1024.png` is generated by `design/app-icon/make-app-icon.py` (see
`design/app-icon/README.md`); don't edit the PNG by hand.

## Not done yet

- On the web, not in the app: adding or editing children (the app says where to add them);
  editing or copying a claim (drafts can be submitted or deleted); GST on claim lines, and a
  claim type's remaining cap while typing; opening a leave request's attachments; applying for
  leave on someone's behalf; and downloading a payslip PDF other than through the share sheet.
- Not exercised by tests, on iPhone or iPad, because the simulator has neither a camera nor
  biometrics: the QR scanner (AVFoundation), the receipt camera, and Face ID or Touch ID. The
  camera is stubbed with `-uitest-camera-stub`, and dark mode is forced with `-uitest-dark` (both
  DEBUG and `-uitest` only).
- Tapping a posted local notification in Notification Center is not driven by a UI test: what
  the refresh posts, its `userInfo` and what a tap on it opens are unit tested, and the inbox's
  own rows open items through the same code, which the UI tests cover.
- Real Split View, Slide Over and Stage Manager resizing are not driven by tests (see "Testing a
  compact width").
- The accessibility audit is automated; a manual VoiceOver and Dynamic Type pass on a real device
  is still to be done.

## Release

Bundle id `crowtech.crowhr` is registered with Apple (`store/apple-resources.json`). Debug builds
are ad-hoc signed with no team; Release carries the Crow Tech team (`project.yml`) and no
entitlements. Signing is Apple cloud signing with the team's App Store Connect API key, used in
place on the Mac and never copied: `APPLE_KEY_ID`, `APPLE_ISSUER_ID` and `APPLE_SIGNING_SECRET_DIR`
(the directory on the Mac with `AuthKey_<key id>.p8` and the build keychain) must be set for the
release scripts:

```sh
CROWHR_BUILD_NUMBER=<n> scripts/ios-release.sh internal --approval <record>     # TestFlight internal only
CROWHR_BUILD_NUMBER=<n> scripts/ios-release.sh production --approval <record>   # App Store build
# The Mac steps it runs, usable alone for a dry rehearsal (no upload):
ssh "$CROWHR_MAC_HOST" 'cd ~/Developer/crowhr-ios && CROWHR_BUILD_NUMBER=<n> scripts/ios-archive-on-mac.sh'
ssh "$CROWHR_MAC_HOST" 'cd ~/Developer/crowhr-ios && CROWHR_BUILD_NUMBER=<n> CROWHR_INTERNAL_ONLY=1 \
  scripts/ios-export-on-mac.sh artifacts/CrowHR-build<n>.xcarchive artifacts/CrowHR-build<n>-export'
```

- Every release needs a written approval record (`--approval`): the approver, the date, the
  version, the scope (`internal` or `production`) and, for `production`, the build number. The
  script refuses without one; its refusal paths are rehearsed by `scripts/ios-release.test.sh`.
- `ios-archive-on-mac.sh` archives Release unsigned for a generic device with the given build number.
- `ios-export-on-mac.sh` has Apple cloud-sign it with the App Store Connect API key, using the
  dedicated build keychain and restoring the original keychain list afterwards. `ios-verify-ipa.py`
  then checks bundle id, version, build, iPhone and iPad (`UIDeviceFamily` [1, 2], the iPhone in
  portrait, the iPad in all four orientations, not full-screen only), Apple Distribution signature,
  team, `get-task-allow` false, no extra entitlements, an App Store profile,
  `PrivacyInfo.xcprivacy`, and an opaque 1024 px icon in `Assets.car`. It writes
  `verification.json` next to the IPA. `scripts/ios-verify-ipa.py --self-test` checks the device
  rules without an IPA.
- The release gate runs the unit tests and the user-flow UI tests (`EssJourneyUITests`) on the
  iPhone simulator (`CROWHR_SIM_UDID`) and the iPad one (`CROWHR_IPAD_SIM_UDID`, required), not
  `QAScreenshotsUITests` (it takes longer). Run the QA audit by hand before a release, on both.
- `ios-release.sh` then runs `altool --validate-app` and `altool --upload-app`, appends the build
  to `store/uploaded-builds.txt` and saves the IPA receipt, marked uploaded with altool's delivery
  id, as `store/build<n>-verification.json`. Never reuse a build number listed there.
- `internal` exports with "TestFlight internal testing only" set. `production` exports for App
  Store distribution (the flag absent; `ios-verify-ipa.py` checks it, and that
  `ITSAppUsesNonExemptEncryption` is false and the app is for iPhone and iPad). It uploads the
  build and stops: it never submits for review.
- The release record (uploaded builds, their IPA checks and the approvals) is kept in `store/`:
  `uploaded-builds.txt`, `build<n>-verification.json` and `approvals/`.
- Internal TestFlight testers must be App Store Connect users on the team; the group **Crow HR
  Internal** has access to all builds. Add testers with
  `scripts/ios-store-register.py invite-internal EMAIL` on the Mac; `testers` lists users, groups
  and tester states.

### App Store listing

`scripts/ios-store-listing.py` (on the Mac, same API key variables) fills what App Store
Connect's API allows from the copy in `store/app-store-metadata.md`:

```sh
ssh "$CROWHR_MAC_HOST" 'cd ~/Developer/crowhr-ios && APPLE_KEY_ID=… APPLE_ISSUER_ID=… APPLE_SIGNING_SECRET_DIR=… \
  /usr/bin/python3 scripts/ios-store-listing.py status|apply|screenshots [DIR]|attach-build <n>'
scripts/ios-store-listing.py check-screenshots   # offline, here or on the Mac: sets and sizes only
```

`apply` names the version from `MARKETING_VERSION` and sets the description, keywords,
promotional text, subtitle, support, marketing and privacy URLs, category (Business), copyright,
the age rating answers (all none or no) and the price (free, every territory). `screenshots`
replaces the 6.9-inch iPhone screenshots (`APP_IPHONE_67`) with `store/screenshots/*.png` and the
13-inch iPad ones (`APP_IPAD_PRO_3GEN_129`) with `store/screenshots/ipad/*.png`, after checking
every PNG's size (iPhone 1320 x 2868 or 1290 x 2796, iPad 2064 x 2752 or 2048 x 2732, either
orientation); `attach-build` attaches a processed build.

`scripts/ios-store-review.py` (same variables) does the App Review side: `status` (which fields are
set, never their values), `review-details` (contact, demo account and reviewer notes, read as JSON
on stdin; `--contact-from-team` reuses the team's App Review contact), `content-rights`,
`exclude CHN` (mainland China needs an ICP filing number) and `submit --build <n> --yes`, which
refuses unless build n is the attached, VALID build and the review details are complete. The App
Privacy answers ("Data Not Collected") have no public API: set them in the web UI.

Store screenshots come from `StoreScreenshotsUITests` on Crow HR's own 6.9-inch simulator
(`CrowHR · Store 6.9`, iPhone 17 Pro Max, 1320 x 2868) with a 9:41 demo status bar, and the
13-inch iPad set from the same class on `CrowHR · iPad 13` (iPad Pro 13-inch (M5), 2064 x 2752
portrait), with the same seed and status bar:

```sh
CROWHR_SIM_UDID=<udid of the simulator> CROWHR_UI_ONLY=CrowHRUITests/StoreScreenshotsUITests \
  CROWHR_UI_STORE_SEED=1 CROWHR_STATUS_BAR=demo scripts/ios-ui-test.sh
```

`CROWHR_UI_STORE_SEED=1` runs `scripts/ios-store-seed.ts`, which publishes Nurul's shifts through
the API so Today shows a schedule. The chosen captures are copied from `artifacts/ios/store-*.png`
to `store/screenshots/` (iPhone) or `store/screenshots/ipad/` (iPad).
