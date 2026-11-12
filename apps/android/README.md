# Crow HR for Android

Native Kotlin + Jetpack Compose app for employees and managers of a company that self-hosts
Crow HR (`openspec/changes/add-mobile-apps`). It talks **only** to that company's server. There
is no Crow Tech backend, analytics, crash reporting or remote push.

- applicationId `crowtech.crowhr` (debug `crowtech.crowhr.debug`), registered in Google Play: never
  change it. `versionName` is in `app/build.gradle.kts`; the release script sets the versionCode
  explicitly, and an uploaded versionCode is never reused.
- Native sign-in redirect `crowtech.crowhr:/oauth2redirect`, QR deep link `crowhr://connect?server=…&org=…`.
- Min API 29, target/compile API 37. Toolchain: AGP 9.4.1, Kotlin 2.4.21, Compose BOM
  2026.09.00, Gradle 9.8.1 (wrapper with the official SHA-256 checksum), JDK 21.

## Build and test

| Command | What it does |
| --- | --- |
| `scripts/android-build.sh check` | Licence notices current, debug APK, unit tests (JVM, shared fixtures in `apps/mobile-fixtures`), lint |
| `apps/android/gradlew -p apps/android :app:generateLicenceNotices` | Rewrites `assets/licences/ThirdParty-Notices.txt` from the release dependencies (after any dependency change) |
| `scripts/android-test-server.sh` | Local seeded server (e2e seed, PGlite in a temp dir) on 127.0.0.1:3197 (`CROWHR_TEST_PORT` for another port) |
| `scripts/android-emulator.sh start` / `wait` / `stop` | The project-owned `CrowHR_QA` AVD only (API 37, 16 KB pages) on emulator-5604 |
| `ANDROID_SERIAL=emulator-5604 scripts/android-build.sh ui` | Every device test except the screenshots: `EssJourneyTest`, `ParityJourneyTest`, `DemoCompanyTest`, `KeystoreStorageTest`, `BackgroundRefreshWorkerTest`, `UprightPhotoTest`. `CROWHR_TEST_CLASS` runs one class (or `Class#method`; one entry only), `CROWHR_TEST_SERVER` points at another test server |
| `scripts/android-qa.sh shots phone\|large\|dark\|large-dark` | Real screenshots into `artifacts/android/screenshots/<variant>`. Tablet size: `adb -s emulator-5604 shell wm size 1600x2560` and `wm density 320` first (reset both after), variant `tablet` |
| `scripts/android-audit.sh` | Zero-data-collection audit of the APK: telemetry/ads/Play Services scan, permissions, dependency tree |
| `scripts/android-release.sh` | Approval-gated release (see Release). `scripts/android-release.test.sh` tests the refusals with dry runs |
| `scripts/android-build.sh clean` | Removes build outputs and stops the Gradle daemon |

Notes:
- **Start the test server and the emulator outside any command sandbox.** The emulator reaches
  the host's loopback at `10.0.2.2`, and a sandboxed network namespace hides it.
- `DemoCompanyTest` needs the test server started with demo companies on, and is skipped
  otherwise: `DEMO_COMPANIES=1 DEMO_COMPANY_POOL_SIZE=0 scripts/android-test-server.sh` (each test
  run starts one demo company, seeded on demand in about 20 s). The rest of the suite runs
  against that server too.
- The API 37 image needs 1.2 x 6 GB free for its data partition check. When the disk is
  nearly full, set `CROWHR_AVD_HOME` to a tmpfs directory. The data image is sparse, so
  it costs only what the emulator writes.
- When another Crow HR session already runs `CrowHR_QA` on 5604, a second copy can run in its
  own AVD home and port, which every script honours: `CROWHR_AVD_HOME=<dir> CROWHR_EMU_PORT=5606
  scripts/android-emulator.sh create`, then `start`, `wait`, and `ANDROID_SERIAL=emulator-5606`.
  Delete it (`scripts/android-emulator.sh delete`) when done.
- Device tests install with `-g` (all runtime permissions granted). A permission granted
  inside a running process doesn't apply to its sockets for Android 17's
  `ACCESS_LOCAL_NETWORK`, and tests can't press system dialogs. The request flows are
  covered by unit tests. A test that calls the server before its `setUp` grants local network
  access times out on a fresh emulator.

## How it works

| Area | Where | Notes |
| --- | --- | --- |
| Connect | `connect/` | Address or QR, then `/api/v1/meta`, then confirm, showing the organisation logo from `logoUrl` when it is on the server's host. When a typed address hosts several organisations (meta `orgSlugRequired`, also on every server with demo companies), an "Organisation ID" field appears (as on iOS) and the check is repeated with `?org=`; a demo company's code goes there. HTTPS only, except private-range or `.local` hosts, which show a warning. Up to 5 saved connections. Screens are gated on the per-module meta `features` (`payslips`, `claims`, `scheduling`, `approvals`, `notifications`, `leave`, `attendance.offlinePunch`); a server that lists none of the module keys falls back to the old baseline. Android 17 local-network permission is requested only for LAN servers |
| Sign-in | `auth/` | Custom Tabs via the documented intent extras (no WebView, no androidx.browser), PKCE S256 and state, then `/native/token`. Closing the browser without finishing returns the button to "Sign in". The access token is renewed a minute before it expires (as on iOS); a 401 still gets one refresh and retry; only Crow HR's own refusal of the refresh (a 4xx with its JSON error) ends the session, while a 408/429 or a proxy's error page counts as offline. A demo company (meta `demo`) is labelled as one; its sign-in page lists its people to pick, with no password |
| Storage | `security/` | One AES-256-GCM key in the Android Keystore (non-exportable). Every value is its own encrypted file in `noBackupFilesDir`, flushed to disk before it replaces the old one. Each value is decrypted once per process and then read from memory until it is removed (sign-out removes everything); the key handle is looked up once. Backups and device transfer exclude everything |
| Lock | `security/AppLock.kt`, `Biometric.kt` | Optional. Platform BiometricPrompt with screen-lock fallback, on a cold start and after more than 5 minutes away |
| HTTP | `api/` | One OkHttp client. A network interceptor allows only the configured server's host (and http only to private hosts). No cache, redirects off |
| Clock in | `punch/` | Append-only encrypted queue: FIFO, idempotency key reused, 200 cap, never drops. A punch's time is the tap's, taken before the location fix or the permission dialog; the location wait, the save and the first send run in the app's scope, so leaving the Clock tab doesn't cancel them, and WorkManager is asked to send as soon as the punch is saved. Sent by WorkManager when online (exponential backoff), with `source: "android"` and `elapsedMs` from `elapsedRealtime` when the phone hasn't rebooted since the tap (checked with `Settings.Global.BOOT_COUNT`). No time-zone field is sent. A punch the server refuses (for example, more than 7 days old) keeps its reason on screen until the employee dismisses it. The screen lists unsent and refused punches plus the last ten sent. Location only when the organisation's policy asks: precise and approximate are requested together and either is used; every enabled platform provider is asked at once (10 s); a punch sent without one says why |
| Time | `core/Formats.kt` | Every date and time is shown in Singapore time (Asia/Singapore), whatever the phone's zone, like the web. `FormatsTest` checks this under other default zones and guards the sources. Captures with the emulator set to New York: `artifacts/android/screenshots/phone-new-york-tz/` |
| Refresh | `notify/` | WorkManager every 15 min with a network constraint. Uses the server's notifications `since` cursor, or createdAt on older servers. Posts a local notification whose text is only the count. Tapping it opens the one new item when exactly one is new (and marks it read), otherwise the approvals or notifications inbox; what to open travels only in the tap's PendingIntent. News for another signed-in connection switches to it first |
| Links | `notify/NotificationLinks.kt`, `ui/Destinations.kt` | A notification's `link` (a web path) maps to an app screen per `apps/mobile-fixtures/notification-link-cases.json`; paths the app has no screen for open nothing, and their inbox row says to use the web |
| Screens | `ui/` | Clock; Leave (balances, apply with live quote, the child for types that need one, withdraw/cancel, team calendar or "Who's away"); Pay (FLAG_SECURE; PDF only on request, never cached); Tasks (approve/reject; rejecting requires a comment); More (claims, schedule, notifications, profile, settings). Bottom bar on phones, a side rail from 600 dp wide; Tasks shows how many approvals wait and More the unread notifications, read by TalkBack from the tab label. Every screen can be pulled to refresh (a "Refresh" accessibility action too). Clock, Leave, Pay and Tasks open on their last content (kept in memory only, cleared at session end) while they load again, as on iOS. The back stack and form fields are saved state (`ui/Routes.kt`, `SaveableStateHolder`), so rotation, process death while the camera or browser is open, and the lock screen keep them. Photos are turned upright from EXIF and shrunk off the main thread; leave attachments follow the server's 5 MB limit |
| Claims | `ui/screens/ClaimScreens.kt`, `core/ClaimMoney.kt` | Several lines per claim with camera receipts; the web's currency list, the rate checked as the server does (S$ per unit, up to 6 decimals) and the S$ amount and claim total shown while typing (`apps/mobile-fixtures/claim-money-cases.json`, the same rules as `packages/core/src/claims/money.ts`). A claim opens to its lines and the actions the server's `actions` allow: change and submit a draft, delete it, withdraw a submitted claim, copy a rejected or withdrawn one into a new draft. A line whose rate is more than 20% from the organisation's last rate for that currency shows the server's exchange-rate warning (`fxWarning`) |
| Schedule | `ui/screens/ScheduleScreen.kt` | Published shifts for two weeks; offers from colleagues to accept or decline; "Swap or give away…" on your own future shifts (colleague and their shift from the roster, optional note); open shifts to pick up; your requests with their status and Cancel. The manager approves in Tasks |

Offline: the payslip list, leave balances and schedule are cached encrypted and shown with an
"offline" note. Payslip details and PDFs are never cached. Everything for a connection is
deleted on sign-out. Unsent clock-ins are deleted only after the user confirms.

**Not in the app yet (on the web):** half days at the start or end of a leave request longer
than one day (the app offers a half day only for a one-day request); applying for leave or
claiming on someone's behalf (owners and HR); adding a child's record; GST on a claim line;
viewing a receipt photo after upload, and opening a leave request from the calendar. Not covered by a
device test: leave attachments from the camera (wired, unit-tested logic), the system browser's
sign-in page and the permission prompts (checked by hand, below), and tapping the posted
notification itself (the tests send the same intent the notification carries).

## Release

- **Upload key:** a dedicated Crow HR key (RSA 4096, alias `crow-hr-upload`, certificate SHA-256
  `00:36:3F:6F:B1:A9:F5:3A:81:CB:2F:B3:C7:D4:96:D9:FF:0B:C7:03:FE:89:DB:3E:6D:47:E6:3A:F0:38:57:10`)
  kept by the maintainers outside the repository: `CROWHR_SIGNING_PROPERTIES` points to its
  `crow-hr.properties`, with the keystore and `crow-hr-upload-certificate.pem` beside it (all
  0600, never in the repo). Google Play App Signing keeps the app signing key; this key only signs
  uploads. A release build also needs JDK 21 (`JAVA_HOME`) and bundletool (`CROWHR_BUNDLETOOL_JAR`).
- **Approval record:** every upload and every production build needs the maintainer's written
  approval in a file passed as `--approval <record>`, in the form `scripts/android-release.sh`
  checks (the approver's line, the package and `versionCode N`). Records are kept in
  `store/approvals/`.
- `CROWHR_ANDROID_VERSION_CODE=N scripts/android-release.sh internal` builds the release AAB
  signed with that key and checks the package, versionCode, signing certificate and
  `bundletool validate`, then copies it to `artifacts/android/crow-hr-<version>-<N>.aab`.
  Adding `--upload --approval <record>` puts it on the **internal** track as a **draft**
  (`scripts/android-play.py upload-internal-draft`).
- `CROWHR_ANDROID_VERSION_CODE=N scripts/android-release.sh production --approval <record> [--out DIR]`
  builds and verifies the same signed AAB for a production release and copies it into `DIR` as
  well. It never uploads; `--upload` is refused for production.
- `scripts/android-play.py status` (read-only), `listing` (store listing, icon, feature
  graphic and phone screenshots from `store/listing.json`) and
  `upload-production-draft AAB --expected-version-code N [--expected-sha256 HEX]` (puts a verified
  AAB on the **production** track as a **draft** release with release notes; it never sends
  anything for review) use the maintainers' Play publisher service account
  (`CROWHR_PLAY_CREDENTIALS`, a Google credentials file) and the `google-auth` Python package.
  Sending a release for review, the App content forms and the rollout stay in Play Console.
- Before an upload: `scripts/android-build.sh check`, the device tests, and a universal APK built
  from the signed AAB (`bundletool build-apks --mode=universal`, debug-signed for the emulator)
  run by hand on `CrowHR_QA`: connect, sign in through Chrome, then every tab.
- Store screenshots: `scripts/android-qa.sh store-shots` (1080 x 1920, demo-mode status bar,
  real app against the fictional test server). With the e2e seed only four screens look right
  (clock, leave request, approvals, new claim); better ones need a curated demo employee.
- What was uploaded, verified and approved for each release is recorded in `store/approvals/`
  and `store/receipts/` (public ids and hashes only).

## Real browser sign-in (manual check)

The device tests stand in for the browser (`TestBrowser` signs in through the same server API,
`PersonaBrowser` picks a demo company's person, and both hand the callback to the app). The real
path is checked by hand on `CrowHR_QA`. The Play image ships Chrome, and the server serves the
built web app (`bun run build` first). Use a fresh install with no pre-granted permissions
(`scripts/android-qa.sh install`), driven by `scripts/android-qa.sh` (`link`, `dump`, `tap`,
`text`, `screenshot`):

1. Open `crowhr://connect?server=http%3A%2F%2F10.0.2.2%3A3197&org=kampong-kopi`, or type the
   address and then the organisation ID. Android 17 asks for local network access (shown as
   "nearby devices"): Allow.
2. The confirm screen shows the organisation (and its logo from meta): Connect, then Sign in.
3. A Chrome Custom Tab opens at `/api/v1/native/authorize…`, which redirects to the server's
   "Sign in to connect the Crow HR app" page. A fresh Chrome first shows its own first-run
   screen ("Stay signed out").
4. Sign in on the page (a demo company lists its people instead: tap one). The page redirects
   to `crowtech.crowhr:/oauth2redirect?code=…&state=…`; Android hands that to the app, which
   exchanges the code and opens Clock, signed in.

Evidence: `artifacts/android/screenshots/real-browser-sign-in/` (password) and
`artifacts/android/screenshots/demo-company-real-browser/` (a demo company: address and company
code typed, persona picked). This is not automated: Chrome's first-run and keyboard screens
differ by Chrome version and need UI Automator on another app's views, which would be brittle.

## App icon

The Crow Tech crow standing on a kuning "HR" card on ivory, in the style of Crow Tech's other app
icons. Adaptive icon: `@color/launcher_background` (ivory), `ic_launcher_foreground.xml` (colour)
and `ic_launcher_monochrome.xml` (themed icons). `store/icon-512.png` is the Play listing icon. All
are generated by `design/app-icon/make-app-icon.py` (see `design/app-icon/README.md`); don't edit
them by hand.

## Dependency audit (for the Play Data safety form)

`scripts/android-audit.sh` output is saved in `artifacts/android/dependency-audit.txt`. The
APK contains no Google Play Services, Firebase, Google data-transport, Play Core, Crashlytics,
Sentry, Bugsnag, Facebook, or ads or attribution SDKs. Every runtime library and whether it
can send data:

| Library (runtime) | Purpose | Network of its own? |
| --- | --- | --- |
| Kotlin stdlib, kotlinx-coroutines, kotlinx-serialization | Language, JSON | No |
| AndroidX Activity, Core, Lifecycle, SavedState, Compose (UI, Foundation, Material 3), Emoji2, Window, ProfileInstaller, Startup, Tracing, NavigationEvent | UI and app plumbing | No. ProfileInstaller writes a local ART profile only |
| AndroidX WorkManager (+ Room, SQLite, Lifecycle-service, Guava listenablefuture) | Background refresh and punch sending | No. Its local database holds job state only |
| AndroidX CameraX (camera2, core, lifecycle, view, video) + AppCompat/Fragment pulled by camera-view | On-device QR preview | No |
| ZXing core 3.5.3 | On-device QR decoding | No |
| OkHttp 4.12.0 + Okio | The single HTTP client, restricted to the company's server host | Only the requests the app makes |
| Fonts: Azeret Mono (OFL 1.1), Ubuntu (Ubuntu Font Licence 1.0) | Bundled in `res/font`; licences in `assets/licences` | No |

Adding a runtime dependency means adding it to this table (the Data safety answers depend on
it) and regenerating the licence notices.

**Licences.** Every library above is Apache-2.0. Settings → Open-source licences shows the
files in `app/src/main/assets/licences`: Crow HR's MIT licence, the two font licences, the
Apache-2.0 text, and `ThirdParty-Notices.txt`, which lists every library in the release APK
with its version and repeats the one NOTICE file they ship (OkHttp's note that its public
suffix data is under MPL 2.0). That list is generated from the release runtime classpath by the
`generateLicenceNotices` task in `app/build.gradle.kts`, which reads each library's licence from
its Maven POM. `checkLicenceNotices` runs before every release build, in `check` and in
`scripts/android-build.sh check`. It fails when the list no longer matches the dependencies, or
when a library's licence is not a reviewed one (only Apache-2.0 today; copyleft is not accepted).

Permissions: INTERNET, ACCESS_NETWORK_STATE, ACCESS_LOCAL_NETWORK (LAN servers only), CAMERA
(QR and receipts), POST_NOTIFICATIONS, ACCESS_COARSE/FINE_LOCATION (only when the organisation's
attendance policy asks, while the app is open), USE_BIOMETRIC. WorkManager adds WAKE_LOCK,
RECEIVE_BOOT_COMPLETED and FOREGROUND_SERVICE.

Data safety: **No data collected or shared by the developer.** All data goes between the device
and the employer's own server, which the employer operates. Data on the device is encrypted and
is deleted on sign-out. This interpretation still needs the legal and policy review noted in the
design's Risks section (see `docs/limitations.md`).
