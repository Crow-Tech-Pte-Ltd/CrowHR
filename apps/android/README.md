# Crow HR for Android

Native Kotlin + Jetpack Compose app for employees and managers of a company that self-hosts
Crow HR (`openspec/changes/add-mobile-apps`). It talks **only** to that company's server. There
is no Crow Tech backend, analytics, crash reporting or remote push.

- applicationId `crowtech.crowhr` (debug `crowtech.crowhr.debug`). Proposed in design decision 3;
  confirm with Daniel before registering anything.
- Native sign-in redirect `crowtech.crowhr:/oauth2redirect`, QR deep link `crowhr://connect?server=…&org=…`.
- Min API 29, target/compile API 37. Toolchain: AGP 9.4.1, Kotlin 2.4.21, Compose BOM
  2026.09.00, Gradle 9.8.1 (wrapper with the official SHA-256 checksum), JDK 21.

## Build and test

| Command | What it does |
| --- | --- |
| `scripts/android-build.sh check` | Debug APK, unit tests (JVM, shared fixtures in `apps/mobile-fixtures`), lint |
| `scripts/android-test-server.sh` | Local seeded server (e2e seed, PGlite in a temp dir) on 127.0.0.1:3197 |
| `scripts/android-emulator.sh start` / `wait` / `stop` | The project-owned `CrowHR_QA` AVD only (API 37, 16 KB pages) |
| `ANDROID_SERIAL=emulator-5604 scripts/android-build.sh ui` | Device tests: `EssJourneyTest`, `KeystoreStorageTest`, `BackgroundRefreshWorkerTest` |
| `scripts/android-qa.sh shots phone\|large\|dark\|large-dark` | Real screenshots into `artifacts/android/screenshots/<variant>` |
| `scripts/android-audit.sh` | Zero-data-collection audit of the APK: telemetry/ads/Play Services scan, permissions, dependency tree |
| `scripts/android-release.sh` | Approval-gated release. `scripts/android-release.test.sh` tests the refusals with dry runs |
| `scripts/android-build.sh clean` | Removes build outputs and stops the Gradle daemon |

Notes for this machine:
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
| Connect | `connect/` | Address or QR, then `/api/v1/meta`, then confirm. HTTPS only, except private-range or `.local` hosts, which show a warning. Up to 5 saved connections. Screens are gated on meta `features`. Android 17 local-network permission is requested only for LAN servers |
| Sign-in | `auth/` | Custom Tabs via the documented intent extras (no WebView, no androidx.browser), PKCE S256 and state, then `/native/token`. One refresh and retry on 401; a refused refresh ends the session |
| Storage | `security/` | One AES-256-GCM key in the Android Keystore (non-exportable). Every value is its own encrypted file in `noBackupFilesDir`. Backups and device transfer exclude everything |
| Lock | `security/AppLock.kt`, `Biometric.kt` | Optional. Platform BiometricPrompt with screen-lock fallback, on a cold start and after more than 5 minutes away |
| HTTP | `api/` | One OkHttp client. A network interceptor allows only the configured server's host (and http only to private hosts). No cache, redirects off |
| Clock in | `punch/` | Append-only encrypted queue: FIFO, idempotency key reused, 200 cap, never drops. Sent by WorkManager when online (exponential backoff) |
| Refresh | `notify/` | WorkManager every 15 min with a network constraint. Uses the server's notifications `since` cursor, or createdAt on older servers. Posts a local notification whose text is only the count |
| Screens | `ui/` | Clock, Leave (balances, apply with live quote, withdraw/cancel), Pay (FLAG_SECURE; PDF only on request, never cached), Tasks (approve/reject; rejecting requires a comment), More (claims with camera receipts, schedule, notifications, profile, settings) |

Offline: the payslip list, leave balances and schedule are cached encrypted and shown with an
"offline" note. Payslip details and PDFs are never cached. Everything for a connection is
deleted on sign-out. Unsent clock-ins are deleted only after the user confirms.

**NOT IMPLEMENTED (yet):** the managers' team leave calendar; editing, withdrawing or copying
claim drafts after saving; shift swaps and open-shift pickup (web only); leave attachments from
the camera are wired but not covered by a device test. The release signing and Play upload steps
are also not implemented (see `scripts/android-release.sh`).

## App icon

`res/drawable/ic_launcher_foreground.xml` is a **placeholder** (ink "C" ring with a square on
kuning). It needs Daniel's approval before any store release.

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

Permissions: INTERNET, ACCESS_NETWORK_STATE, ACCESS_LOCAL_NETWORK (LAN servers only), CAMERA
(QR and receipts), POST_NOTIFICATIONS, ACCESS_COARSE/FINE_LOCATION (only when the organisation's
attendance policy asks, while the app is open), USE_BIOMETRIC. WorkManager adds WAKE_LOCK,
RECEIVE_BOOT_COMPLETED and FOREGROUND_SERVICE.

Data safety draft (for review, not submitted): **No data collected or shared by the
developer.** All data goes between the device and the employer's own server, which the
employer operates. Data on the device is encrypted and is deleted on sign-out. This
interpretation needs the legal and policy review noted in the design's Risks section before
submission.
