## Context

This change is planning-only. Implementation is M4. The server contract it depends on, `/api/v1`, meta, native auth and device sessions, is specified in `add-api-platform` and lands in M1. The process follows the maintainers' mobile workflow:
- iOS on a Mac via SSH and rsync;
- Android on Linux, with the Android SDK (`ANDROID_HOME`, default `~/Android/Sdk`), JDK 21 and a pinned Gradle wrapper;
- a project-owned emulator;
- uploads to internal tracks only;
- credentials by path only;
- privacy and support pages in the crow-tech-landing repo, hidden from global navigation.

Requirements are in `specs/mobile-apps`.

## Goals / Non-Goals

**Goals:** apps that keep working against servers up to 12 months older; no Crow-run infrastructure; shared fixtures so both platforms test the same journeys.

**Non-Goals:** a shared cross-platform UI framework. The owner chose native SwiftUI and Compose, and there is no React Native or KMP.

## Decisions

1. **API client from the OpenAPI snapshot.** Swift and Kotlin models are generated from `packages/core/openapi/v1.snapshot.json` with `swift-openapi-generator` and `openapi-generator` (kotlin, kotlinx-serialization), or hand-written thin clients if the generators bloat. The choice is made at implementation and verified by contract tests. Unknown fields and enum values are tolerated, so the decoders are lenient.

2. **Feature detection, not version comparison.** Meta's `features` list, such as `leave`, `claims.fx` and `attendance.offlinePunch`, gates screens. The app keeps a table that maps each screen to the features it needs. This handles servers older than the app gracefully.

3. **Identifiers.** The proposed bundle and application ID is `crowtech.crowhr`, following the existing Crow convention (`crowtech.learningta`). The native redirect is `crowtech.crowhr:/oauth2redirect`, and the QR deep link is `crowhr://connect`. Both are to be confirmed with Daniel before registering anything.

4. **Local storage.** iOS uses Keychain for tokens and a SwiftData or SQLite store with `NSFileProtectionComplete` for cache and queue. Android uses a Keystore AES key wrapping a Room/DataStore cache, with `android:allowBackup="false"` and data-extraction rules excluding everything. The cache is limited to what offline screens need, and payslip PDFs are not cached.

5. **Punch queue.** This is an append-only local table. A sender drains it in FIFO order with exponential backoff, using the idempotency key as the request header. The server's response is stored per punch. Location is requested only "while using", and only when the org policy needs it. Server-side validation (geofence flag, time-skew flag, late-sync flag) belongs to the attendance spec, M2. The app only displays the outcome.

6. **Remote push (open).** APNs needs a key held by the app's publisher (Crow Tech), so any remote push needs a relay that sees device tokens and timing metadata. That breaks "Crow runs no backend" unless it is opt-in and documented. Options for a later decision:
   - (a) no remote push, the v1 choice;
   - (b) an opt-in Crow relay that carries content-free wake-ups only;
   - (c) UnifiedPush on Android, with the company running its own distributor such as ntfy (no iOS equivalent).

7. **Test server.** UI tests start `apps/server` with `DATABASE_URL=pglite:memory` and the demo seed. Android tests reach it from the emulator via `10.0.2.2`. iOS tests reach it from the Mac over an SSH reverse tunnel, so no public port is opened. A recording proxy in the test harness asserts the network allow-list.

## Risks / Trade-offs

- [Store reviewers need a working server and account] → provide a reviewer server only with Daniel's approval. Alternatively, reviewers can use the public demo, which is read-only and resettable. That requires the demo to expose the API, which is an open item for the demo workstream.
- ["Data Not Collected" depends on Apple's and Google's definitions, since data goes to the employer's server and not to Crow] → legal and policy review before submission, with the privacy page explaining the model.
- [Self-signed certificates on LAN installs] → not supported. The docs recommend Caddy with an internal CA or a public domain, and the app explains a TLS failure clearly.
- [Private-use scheme hijack on Android] → mitigated by PKCE (see `add-api-platform` design).

## Migration Plan

None (new apps).

## Open Questions

- Remote push approach (decision 6). It does not change v1 scope.
- Bundle IDs (decision 3) and the store account to publish under (the existing Crow Tech developer accounts).
