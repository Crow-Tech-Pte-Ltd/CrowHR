# Crow HR for Android

Native Kotlin + Jetpack Compose app for employees and managers of a company that self-hosts
Crow HR (`openspec/changes/add-mobile-apps`). It talks **only** to that company's server. There
is no Crow Tech backend, analytics, crash reporting or remote push.

- applicationId `crowtech.crowhr` (debug `crowtech.crowhr.debug`), registered in Play Console.
  Version **1.0.0 (versionCode 2)**; the release script sets the versionCode explicitly.
- Native sign-in redirect `crowtech.crowhr:/oauth2redirect`, QR deep link `crowhr://connect?server=…&org=…`.
- Min API 29, target/compile API 37. Toolchain: AGP 9.4.1, Kotlin 2.4.21, Compose BOM
  2026.09.00, Gradle 9.8.1 (wrapper with the official SHA-256 checksum), JDK 21.

## Build and test

| Command | What it does |
| --- | --- |
| `scripts/android-build.sh check` | Licence notices current, debug APK, unit tests (JVM, shared fixtures in `apps/mobile-fixtures`), lint |
| `apps/android/gradlew -p apps/android :app:generateLicenceNotices` | Rewrites `assets/licences/ThirdParty-Notices.txt` from the release dependencies (after any dependency change) |
| `scripts/android-test-server.sh` | Local seeded server (e2e seed, PGlite in a temp dir) on 127.0.0.1:3197 |
| `scripts/android-emulator.sh start` / `wait` / `stop` | The project-owned `CrowHR_QA` AVD only (API 37, 16 KB pages) |
| `ANDROID_SERIAL=emulator-5604 scripts/android-build.sh ui` | Device tests: `EssJourneyTest`, `KeystoreStorageTest`, `BackgroundRefreshWorkerTest`, `UprightPhotoTest` |
| `scripts/android-qa.sh shots phone\|large\|dark\|large-dark` | Real screenshots into `artifacts/android/screenshots/<variant>`. Tablet size: `adb -s emulator-5604 shell wm size 1600x2560` and `wm density 320` first (reset both after), variant `tablet` |
| `scripts/android-audit.sh` | Zero-data-collection audit of the APK: telemetry/ads/Play Services scan, permissions, dependency tree |
| `scripts/android-release.sh` | Approval-gated release. `scripts/android-release.test.sh` tests the refusals with dry runs |
| `scripts/android-build.sh clean` | Removes build outputs and stops the Gradle daemon |

Notes:
- **Start the test server and the emulator outside any command sandbox.** The emulator reaches
  the host's loopback at `10.0.2.2`, and a sandboxed network namespace hides it.
- The API 37 image needs 1.2 x 6 GB free for its data partition check. When the disk is
  nearly full, set `CROWHR_AVD_HOME` to a tmpfs directory. The data image is sparse, so
  it costs only what the emulator writes.
- Device tests install with `-g` (all runtime permissions granted). A permission granted
  inside a running process doesn't apply to its sockets for Android 17's
  `ACCESS_LOCAL_NETWORK`, and tests can't press system dialogs. The request flows are
  covered by unit tests.

## How it works

| Area | Where | Notes |
| --- | --- | --- |
| Connect | `connect/` | Address or QR, then `/api/v1/meta`, then confirm, showing the organisation logo from `logoUrl` when it is on the server's host. When a typed address hosts several organisations, an "Organisation ID" field appears (as on iOS) and the check is repeated with `?org=`. HTTPS only, except private-range or `.local` hosts, which show a warning. Up to 5 saved connections. Screens are gated on the per-module meta `features` (`payslips`, `claims`, `scheduling`, `approvals`, `notifications`, `leave`, `attendance.offlinePunch`); a server that lists none of the module keys falls back to the old baseline. Android 17 local-network permission is requested only for LAN servers |
| Sign-in | `auth/` | Custom Tabs via the documented intent extras (no WebView, no androidx.browser), PKCE S256 and state, then `/native/token`. Closing the browser without finishing returns the button to "Sign in". One refresh and retry on 401; only Crow HR's own refusal of the refresh (a 4xx with its JSON error) ends the session, while a 408/429 or a proxy's error page counts as offline |
| Storage | `security/` | One AES-256-GCM key in the Android Keystore (non-exportable). Every value is its own encrypted file in `noBackupFilesDir`. Backups and device transfer exclude everything |
| Lock | `security/AppLock.kt`, `Biometric.kt` | Optional. Platform BiometricPrompt with screen-lock fallback, on a cold start and after more than 5 minutes away |
| HTTP | `api/` | One OkHttp client. A network interceptor allows only the configured server's host (and http only to private hosts). No cache, redirects off |
| Clock in | `punch/` | Append-only encrypted queue: FIFO, idempotency key reused, 200 cap, never drops. Sent by WorkManager when online (exponential backoff), with `source: "android"` and `elapsedMs` from `elapsedRealtime` when the phone hasn't rebooted since the tap (checked with `Settings.Global.BOOT_COUNT`). No time-zone field is sent. A punch the server refuses (for example, more than 7 days old) keeps its reason on screen until the employee dismisses it. The screen lists unsent and refused punches plus the last ten sent. Location only when the organisation's policy asks: precise and approximate are requested together and either is used; every enabled platform provider is asked at once (10 s); a punch sent without one says why |
| Time | `core/Formats.kt` | Every date and time is shown in Singapore time (Asia/Singapore), whatever the phone's zone, like the web. `FormatsTest` checks this under other default zones and guards the sources. Captures with the emulator set to New York: `artifacts/android/screenshots/phone-new-york-tz/` |
| Refresh | `notify/` | WorkManager every 15 min with a network constraint. Uses the server's notifications `since` cursor, or createdAt on older servers. Posts a local notification whose text is only the count |
| Screens | `ui/` | Clock, Leave (balances, apply with live quote, withdraw/cancel), Pay (FLAG_SECURE; PDF only on request, never cached), Tasks (approve/reject; rejecting requires a comment), More (claims with camera receipts, schedule, notifications, profile, settings). Bottom bar on phones, a side rail from 600 dp wide. Every screen can be pulled to refresh (a "Refresh" accessibility action too). The back stack and form fields are saved state (`ui/Routes.kt`, `SaveableStateHolder`), so rotation, process death while the camera or browser is open, and the lock screen keep them. Photos are turned upright from EXIF and shrunk off the main thread; leave attachments follow the server's 5 MB limit |

Offline: the payslip list, leave balances and schedule are cached encrypted and shown with an
"offline" note. Payslip details and PDFs are never cached. Everything for a connection is
deleted on sign-out. Unsent clock-ins are deleted only after the user confirms.

**NOT IMPLEMENTED (yet):** the managers' team leave calendar; editing, withdrawing or copying
claim drafts after saving ("Save for later" says to finish them on the web); leave types that
need a child, such as childcare leave (left out of the list with a note, as on iOS); shift swaps
and open-shift pickup (web only); leave attachments from the camera are wired but not covered by
a device test. Uploading to Google Play and releasing
to production are done in Play Console, not by a script.

## Release

- **Upload key:** a dedicated Crow HR key (RSA 4096, alias `crow-hr-upload`, certificate SHA-256
  `00:36:3F:6F:B1:A9:F5:3A:81:CB:2F:B3:C7:D4:96:D9:FF:0B:C7:03:FE:89:DB:3E:6D:47:E6:3A:F0:38:57:10`)
  kept by the maintainers outside the repository: `CROWHR_SIGNING_PROPERTIES` points to its
  `crow-hr.properties`, with the keystore and `crow-hr-upload-certificate.pem` beside it (all
  0600, never in the repo). Google Play App Signing keeps the app signing key; this key only signs
  uploads. A release build also needs JDK 21 (`JAVA_HOME`) and bundletool (`CROWHR_BUNDLETOOL_JAR`).
- `CROWHR_ANDROID_VERSION_CODE=N scripts/android-release.sh internal` builds the release AAB
  signed with that key and checks the package, versionCode, signing certificate and
  `bundletool validate`, then copies it to `artifacts/android/crow-hr-<version>-<N>.aab`.
  Adding `--upload --approval <record>` puts it on the **internal** track as a **draft**
  (`scripts/android-play.py upload-internal-draft`). Never reuse an uploaded versionCode.
- `CROWHR_ANDROID_VERSION_CODE=N scripts/android-release.sh production --approval <record> [--out DIR]`
  builds and verifies the same signed AAB for a production release (the record must say
  "Approved by Daniel", name the package and "versionCode N") and copies it into `DIR` as well.
  It never uploads; `--upload` is refused for production.
- `scripts/android-play.py status` (read-only), `listing` (store listing, icon, feature
  graphic and phone screenshots from `store/listing.json`) and
  `upload-production-draft AAB --expected-version-code N [--expected-sha256 HEX]` (puts a verified
  AAB on the **production** track as a **draft** release with release notes; it never sends
  anything for review) use the maintainers' Play publisher service account
  (`CROWHR_PLAY_CREDENTIALS`, a Google credentials file) and the `google-auth` Python package.
- Store screenshots: `scripts/android-qa.sh store-shots` (1080 x 1920, demo-mode status bar,
  real app against the fictional test server). With the e2e seed only four screens look right
  (clock, leave request, approvals, new claim); better ones need a curated demo employee.
  Checked on 10 Nov 2026 for 1.0.0: the app's screens haven't changed since those four were taken
  (7 Nov), so they still show the current UI.
- **Checked on 7 Nov 2026:** versionCode 1 built, signed and verified (SHA-256
  `771ce166...fe54c`). A universal APK made from that AAB installed on the Android 17 emulator,
  read the server's details, signed in through Chrome and opened the home screen. The other tabs
  were not walked through: the emulator was killed when the machine ran out of memory.
- **Uploaded 7 Nov 2026** with Daniel's approval (`store/approvals/2026-11-07-internal-1.txt`):
  versionCode 1 is a **draft** release "0.1.0 (1)" on internal testing (not rolled out, no testers);
  Play App Signing is on. It went through the Play Console web UI because the Play API
  credentials needed renewing, so `android-play.py upload-internal-draft` has not run yet. Receipt:
  `store/receipts/internal-draft-1.json`. The default store listing (en-GB text, icon, feature
  graphic, four screenshots) is saved as a draft in Console. versionCode 1 is used: next upload 2+.
- **Production 1.0.0 (versionCode 2), 10 Nov 2026.** Daniel approved a public release of both apps
  ("Submit both"; record `store/approvals/2026-11-10-production-1.0.0.txt`).
  `CROWHR_ANDROID_VERSION_CODE=2 scripts/android-release.sh production --approval <record> --out <dir>`
  built the AAB signed with the upload key and verified the package, versionCode 2, the upload
  certificate and `bundletool validate` (SHA-256
  `540c7e4cdd38f54464ff31e79989962fcaec5e2c2857a8eed843a20dff40ba66`). The AAB is kept outside the
  repository for the Play Console upload; it is not in git. Universal APKs built from it
  (`bundletool build-apks --mode=universal`, debug-signed for the emulator) were run by hand on
  `CrowHR_QA` (Android 17, 16 KB pages):
  - against the seeded test server, with the build just before the organisation ID field was
    added: the local-network prompt, the confirm screen, sign-in in a Chrome Custom Tab, clock in,
    leave balances, payslips, approvals, More, the schedule, Settings (version 1.0.0) and the
    licences screen with the third-party notices (`artifacts/android/screenshots/release-1.0.0-smoke/`);
  - with the final AAB, against the store reviewer server: typing `https://hr-demo.crow.sg`
    asked for the organisation ID, `kopi-kaki` showed "Kopi Kaki" to confirm, and Sign in opened
    the server's sign-in page in a Custom Tab. It stopped there, without signing in
    (`artifacts/android/screenshots/release-1.0.0-reviewer-connect/`).
- **Uploaded 11 Nov 2026:** `android-play.py listing` set the en-GB listing, icon, feature graphic
  and the four screenshots (receipt `store/receipts/listing.json`), and
  `android-play.py upload-production-draft` put versionCode 2 on the production track as a draft
  release "2 (1.0.0)"; Google Play reported the same SHA-256 as the verified AAB (receipt
  `store/receipts/production-draft-2.json`). In Play Console: privacy policy URL, ads (none),
  advertising ID (not used), government app (no), financial features (none), health features
  (none), trader status (applies) and the content rating (IARC: Everyone / PEGI 3 / 3+, interactive
  element "Shares Location", because a punch's location is visible to HR when the company turns
  location on). Data safety declares no data collected or shared (the app sends data only to the
  user's own company's server; Crow Tech receives nothing).
- **Sent for review on 12 Nov 2026 (Play Console):** sign-in details for reviewers (the Hafiz and
  Siti accounts, see `docs/sample-company.md`), target audience 18 and over, Data safety,
  app category Business, all 178 countries and regions, and the production release "2 (1.0.0)".
  Managed publishing is off, so it goes live once Google approves it.

## Real browser sign-in (verified on the emulator, 7 Nov 2026)

The device tests stand in for the browser (`TestBrowser` signs in through the same server API
and hands the callback to the app). The real path was also run on `CrowHR_QA`. The Play image
ships Chrome, and the server serves the built web app (`bun run build` first). The run used a
fresh install with no pre-granted permissions, driven by `scripts/android-qa.sh` (`link`, `dump`,
`tap`, `text`, `screenshot`). Evidence is in `artifacts/android/screenshots/real-browser-sign-in/`:

1. Opening `crowhr://connect?server=http%3A%2F%2F10.0.2.2%3A3197&org=kampong-kopi` asks for
   Android 17's local network access (shown as "nearby devices"): Allow.
2. The confirm screen shows the organisation logo from meta: Connect, then Sign in.
3. A Chrome Custom Tab opens at `/api/v1/native/authorize…`, which redirects to the server's
   "Sign in to connect the Crow HR app" page. A fresh Chrome first shows its own first-run
   screen ("Stay signed out").
4. After email and password, the page redirects to `crowtech.crowhr:/oauth2redirect?code=…&state=…`.
   Android hands that to the app, which exchanges the code and opens Clock, signed in.

This is not an automated test. Chrome's first-run and keyboard screens differ by Chrome version
and need UI Automator on another app's views, which would be brittle. Re-run it by hand with the
steps above.

## Play Console

App created 7 Nov 2026 in Crow Tech's Play account (7071629237355404162): "Crow HR", package
`crowtech.crowhr`, English (United Kingdom), app, free. Console app id `4976368088435434771`. Play
App Signing is on with the upload key above; versionCode 1 (0.1.0) is a draft on internal testing,
and the default store listing is saved as a draft. Nothing is published yet.

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

**Licences.** Every library above is Apache-2.0. Settings → Open-source licences shows the
files in `app/src/main/assets/licences`: Crow HR's MIT licence, the two font licences, the
Apache-2.0 text, and `ThirdParty-Notices.txt`, which lists all 100 libraries in the release APK
with their versions and repeats the one NOTICE file they ship (OkHttp's note that its public
suffix data is under MPL 2.0). That list is generated from the release runtime classpath by the
`generateLicenceNotices` task in `app/build.gradle.kts`, which reads each library's licence from
its Maven POM. `checkLicenceNotices` runs before every release build, in `check` and in
`scripts/android-build.sh check`. It fails when the list no longer matches the dependencies, or
when a library's licence is not a reviewed one (only Apache-2.0 today; copyleft is not accepted).

Permissions: INTERNET, ACCESS_NETWORK_STATE, ACCESS_LOCAL_NETWORK (LAN servers only), CAMERA
(QR and receipts), POST_NOTIFICATIONS, ACCESS_COARSE/FINE_LOCATION (only when the organisation's
attendance policy asks, while the app is open), USE_BIOMETRIC. WorkManager adds WAKE_LOCK,
RECEIVE_BOOT_COMPLETED and FOREGROUND_SERVICE.

Data safety (submitted with 1.0.0 on 12 Nov 2026): **No data collected or shared by the
developer.** All data goes between the device and the employer's own server, which the
employer operates. Data on the device is encrypted and is deleted on sign-out. This
interpretation still needs the legal and policy review noted in the design's Risks section; it
was not done before the 1.0.0 submission (see `docs/limitations.md`).
